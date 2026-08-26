const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const { put: putBlob, del: delBlob } = require('@vercel/blob');

const ROOT = __dirname;
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? '/tmp' : ROOT;
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = IS_VERCEL ? path.join('/tmp', 'uploads') : path.join(ROOT, 'assets', 'uploads');
const ORDERS_DIR = path.join(DATA_DIR, 'orders');
const PORT = Number(process.env.PORT) || 3000;
const BADGE_IDS = new Set(['promo', 'last', 'sale']);
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const USE_BLOB = Boolean(BLOB_TOKEN);

function loadProducts() {
  const code = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return Array.isArray(context.window.PRODUCTS) ? context.window.PRODUCTS : [];
}

const PRODUCTS = loadProducts();
const PRODUCT_BY_ID = new Map(PRODUCTS.map(p => [p.id, p]));
const LOCAL_CATALOGS = new Set(['Boxers y Slips 2026', 'Lencería 2026', 'Medias 2026']);

function defaultPublishedIds() {
  return PRODUCTS.filter(p => LOCAL_CATALOGS.has(p.catalog)).map(p => p.id);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  if (storedBuf.length !== test.length) return false;
  return crypto.timingSafeEqual(storedBuf, test);
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name || user.username,
    role: user.role,
    priceListId: user.priceListId || null
  };
}

function seedDb() {
  const mayoristaId = 'lista-mayorista';
  const minoristaId = 'lista-minorista';
  return {
    sessionSecret: crypto.randomBytes(24).toString('hex'),
    publishedIds: defaultPublishedIds(),
    productMeta: {},
    priceLists: [
      { id: mayoristaId, name: 'Agosto 2026 Capital', prices: {} },
      { id: minoristaId, name: 'Minorista', prices: {} }
    ],
    users: [
      {
        id: 'user-admin',
        username: 'admin',
        name: 'Administrador',
        passwordHash: hashPassword('admin123'),
        role: 'admin',
        priceListId: mayoristaId
      },
      {
        id: 'user-cliente',
        username: 'cliente',
        name: 'Cliente demo',
        passwordHash: hashPassword('cliente123'),
        role: 'cliente',
        priceListId: mayoristaId
      }
    ],
    settings: { whatsappNumber: '' }
  };
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const seeded = seedDb();
    saveDb(seeded);
    return seeded;
  }
  const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  parsed.publishedIds = Array.isArray(parsed.publishedIds) ? parsed.publishedIds : [];
  parsed.priceLists = Array.isArray(parsed.priceLists) ? parsed.priceLists : [];
  parsed.users = Array.isArray(parsed.users) ? parsed.users : [];
  parsed.productMeta = parsed.productMeta && typeof parsed.productMeta === 'object' ? parsed.productMeta : {};
  parsed.settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  if (typeof parsed.settings.whatsappNumber !== 'string') parsed.settings.whatsappNumber = '';
  if (!parsed.sessionSecret) parsed.sessionSecret = crypto.randomBytes(24).toString('hex');
  const validIds = new Set(PRODUCTS.map(p => p.id));
  parsed.publishedIds = parsed.publishedIds.filter(id => validIds.has(id));
  for (const id of Object.keys(parsed.productMeta)) {
    if (!validIds.has(id)) delete parsed.productMeta[id];
  }
  if (!parsed.publishedIds.length) parsed.publishedIds = defaultPublishedIds();
  for (const list of parsed.priceLists) {
    if (!list.prices || typeof list.prices !== 'object') list.prices = {};
    for (const id of Object.keys(list.prices)) {
      if (!validIds.has(id)) delete list.prices[id];
    }
  }
  const agostoPath = path.join(ROOT, 'agosto-2026-capital-prices.json');
  const seedPath = fs.existsSync(agostoPath) ? agostoPath : path.join(ROOT, 'multilupo-prices.json');
  const mayorista = parsed.priceLists.find(l => l.id === 'lista-mayorista') || parsed.priceLists[0];
  if (mayorista && Object.keys(mayorista.prices).length === 0 && fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    for (const [id, price] of Object.entries(seed)) {
      if (validIds.has(id) && Number.isFinite(price)) mayorista.prices[id] = price;
    }
    if (fs.existsSync(agostoPath)) mayorista.name = 'Agosto 2026 Capital';
  }
  saveDb(parsed);
  return parsed;
}

function saveDb(data) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const tmp = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DB_PATH);
  } catch (err) {
    console.warn('No se pudo guardar db.json:', err.message);
  }
}

let db = loadDb();

function getUserById(id) {
  return db.users.find(u => u.id === id) || null;
}

function getSessionUser(req) {
  const username = req.session?.username;
  if (username) {
    return db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase()) || null;
  }
  return getUserById(req.session?.userId);
}

function getListById(id) {
  return db.priceLists.find(l => l.id === id) || null;
}

function parseArs(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  let s = String(raw).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function getMeta(id) {
  if (!db.productMeta) db.productMeta = {};
  return db.productMeta[id] || {};
}

function setMeta(id, patch) {
  if (!db.productMeta) db.productMeta = {};
  const current = { ...(db.productMeta[id] || {}), ...patch };
  if (!current.image) delete current.image;
  if (!current.name) delete current.name;
  if (!current.badge) delete current.badge;
  if (!current.badgeText) delete current.badgeText;
  if (current.colorImages && typeof current.colorImages === 'object') {
    const cleaned = {};
    for (const [code, image] of Object.entries(current.colorImages)) {
      if (image) cleaned[code] = image;
    }
    if (Object.keys(cleaned).length) current.colorImages = cleaned;
    else delete current.colorImages;
  } else {
    delete current.colorImages;
  }
  if (!Object.keys(current).length) delete db.productMeta[id];
  else db.productMeta[id] = current;
  return db.productMeta[id] || {};
}

function resolvedName(p) {
  return getMeta(p.id).name || p.name;
}

function parseName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function resolvedImage(p) {
  return getMeta(p.id).image || p.image;
}

function resolvedColors(p) {
  const overrides = getMeta(p.id).colorImages || {};
  return (p.colors || []).map(c => {
    const code = String(c.code || '');
    const custom = overrides[code];
    return {
      code: c.code,
      name: c.name,
      image: custom || c.image || '',
      originalImage: c.image || '',
      hasCustomImage: Boolean(custom)
    };
  });
}

function setColorImage(id, colorCode, imagePath) {
  const meta = getMeta(id);
  const colorImages = { ...(meta.colorImages || {}) };
  if (imagePath) colorImages[colorCode] = imagePath;
  else delete colorImages[colorCode];
  return setMeta(id, { colorImages });
}

async function saveDataUrl(productId, dataUrl, suffix = '') {
  const match = String(dataUrl || '').match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return { error: 'Usá una imagen JPG, PNG o WEBP.' };
  const mimeExt = match[2].toLowerCase();
  const ext = mimeExt === 'jpeg' || mimeExt === 'jpg' ? 'jpg' : mimeExt;
  const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const buf = Buffer.from(match[3].replace(/\s/g, ''), 'base64');
  if (!buf.length) return { error: 'La imagen está vacía.' };
  // Vercel Functions limit request bodies to ~4.5 MB; keep a safe decoded margin.
  const maxBytes = IS_VERCEL ? 3.5 * 1024 * 1024 : 6 * 1024 * 1024;
  if (buf.length > maxBytes) {
    return { error: IS_VERCEL ? 'La imagen no puede superar ~3.5 MB en producción.' : 'La imagen no puede superar 6 MB.' };
  }
  const safeId = String(productId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'producto';
  const safeSuffix = String(suffix || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  const filename = `${safeId}${safeSuffix ? `-${safeSuffix}` : ''}-${Date.now()}.${ext}`;

  if (USE_BLOB) {
    try {
      const blob = await putBlob(`uploads/${filename}`, buf, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
        token: BLOB_TOKEN
      });
      return { path: blob.url };
    } catch (err) {
      return { error: `No se pudo guardar la imagen: ${err.message}` };
    }
  }

  if (IS_VERCEL) {
    return {
      error: 'En Vercel las fotos necesitan BLOB_READ_WRITE_TOKEN (Storage → Blob). Sin eso el archivo no se puede servir.'
    };
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const abs = path.join(UPLOADS_DIR, filename);
  try {
    fs.writeFileSync(abs, buf);
  } catch (err) {
    return { error: `No se pudo guardar la imagen: ${err.message}` };
  }
  return { path: `assets/uploads/${filename}` };
}

async function deleteUpload(relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/');
  if (!rel) return;
  if (/^https?:\/\//i.test(rel)) {
    if (!USE_BLOB) return;
    try { await delBlob(rel, { token: BLOB_TOKEN }); } catch {}
    return;
  }
  if (!rel.startsWith('assets/uploads/')) return;
  const filename = path.basename(rel);
  const abs = path.join(UPLOADS_DIR, filename);
  if (abs.startsWith(UPLOADS_DIR) && fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch {}
  }
}

function parseBadge(raw) {
  const badge = String(raw || '').trim();
  if (!badge) return '';
  return BADGE_IDS.has(badge) ? badge : null;
}

function parseBadgeText(raw) {
  return String(raw || '').trim().slice(0, 40);
}

function productAdminView(p) {
  const meta = getMeta(p.id);
  const published = new Set(db.publishedIds);
  return {
    id: p.id,
    code: p.code,
    name: resolvedName(p),
    originalName: p.name,
    hasCustomName: Boolean(meta.name),
    category: p.category,
    catalog: p.catalog,
    pdf: p.pdf || null,
    page: p.page || null,
    image: resolvedImage(p),
    originalImage: p.image,
    hasCustomImage: Boolean(meta.image),
    colors: resolvedColors(p),
    badge: meta.badge || '',
    badgeText: meta.badgeText || '',
    fobUsd: p.fobUsd ?? null,
    published: published.has(p.id)
  };
}

function catalogCover(pdf, image) {
  const raw = String(pdf || '');
  if (raw.startsWith('http')) return image || '';
  const base = path.basename(raw, '.pdf');
  return base ? `assets/pages/${base}-001.jpg` : (image || '');
}

function catalogSummaries(list) {
  const map = new Map();
  for (const p of list) {
    if (!map.has(p.catalog)) {
      map.set(p.catalog, {
        catalog: p.catalog,
        cover: catalogCover(p.pdf, p.image),
        pdf: p.pdf,
        count: 0
      });
    }
    map.get(p.catalog).count += 1;
  }
  return [...map.values()];
}

function catalogProduct(p, priceArs, { includeFob = false } = {}) {
  const meta = getMeta(p.id);
  const item = {
    id: p.id,
    code: p.code,
    name: resolvedName(p),
    category: p.category,
    catalog: p.catalog,
    pdf: p.pdf,
    page: p.page,
    image: resolvedImage(p),
    hasCustomImage: Boolean(meta.image),
    colors: resolvedColors(p).map(({ code, name, image, hasCustomImage }) => ({ code, name, image, hasCustomImage })),
    sizes: p.sizes || '',
    description: p.description || '',
    tech: p.tech || [],
    badge: meta.badge || '',
    badgeText: meta.badgeText || '',
    priceArs: Number.isFinite(priceArs) ? priceArs : null
  };
  if (includeFob) item.fobUsd = Number.isFinite(p.fobUsd) ? p.fobUsd : null;
  return item;
}

function loadCatalogRegistry() {
  const registryPath = path.join(ROOT, 'catalogs.json');
  if (!fs.existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function adminCatalogSummaries() {
  const counts = new Map();
  const fobCounts = new Map();
  for (const p of PRODUCTS) {
    counts.set(p.catalog, (counts.get(p.catalog) || 0) + 1);
    if (Number.isFinite(p.fobUsd)) fobCounts.set(p.catalog, (fobCounts.get(p.catalog) || 0) + 1);
  }
  return loadCatalogRegistry().map(entry => {
    const abs = path.join(ROOT, entry.pdf || '');
    const exists = Boolean(entry.pdf && fs.existsSync(abs));
    const size = exists ? fs.statSync(abs).size : 0;
    return {
      id: entry.id,
      name: entry.name,
      pdf: entry.pdf,
      origin: entry.origin || 'brasil',
      exists,
      size,
      productCount: counts.get(entry.name) || 0,
      fobCount: fobCounts.get(entry.name) || 0
    };
  });
}

function escapeXml(value) {
  return (value ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoneyPlain(value) {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(2);
}

function buildOrderExcelXml({ clientName, username, items, notes, currency = 'ARS' }) {
  const isFob = currency === 'USD';
  const priceKey = isFob ? 'fobUsd' : 'priceArs';
  const priceLabel = isFob ? 'Precio FOB USD' : 'Precio ARS';
  const totalLabel = isFob ? 'Total FOB USD' : 'Total ARS';
  const header = ['Codigo', 'Producto', 'Talle', 'Color', 'Cantidad', priceLabel, totalLabel];
  const body = items.map(item => {
    const price = Number.isFinite(item[priceKey]) ? item[priceKey] : null;
    const total = price != null ? price * Number(item.qty || 0) : null;
    const color = item.colorName || item.colorCode || '';
    return [
      item.code,
      item.name || '',
      item.size || '',
      color,
      String(item.qty),
      formatMoneyPlain(price),
      formatMoneyPlain(total)
    ];
  });
  const qtyTotal = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const moneyTotal = items.reduce((sum, item) => {
    if (!Number.isFinite(item[priceKey])) return sum;
    return sum + item[priceKey] * Number(item.qty || 0);
  }, 0);
  const info = [
    ['Cliente', clientName],
    ['Usuario', username],
    ['Tipo', isFob ? 'Pedido Brasil (FOB)' : 'Pedido mayorista'],
    ['Fecha', new Date().toLocaleString('es-AR')],
    ['Unidades', String(qtyTotal)],
    [totalLabel, formatMoneyPlain(moneyTotal)],
    ['Notas', notes || '']
  ];
  const allRows = [...info, [], header, ...body];
  const numberCols = new Set([4, 5, 6]);
  const xmlRows = allRows.map((row, rowIndex) => {
    const isItem = rowIndex > info.length + 1;
    const cells = row.map((cell, colIndex) => {
      const isNumber = isItem && numberCols.has(colIndex) && cell !== '';
      const type = isNumber ? 'Number' : 'String';
      return `<Cell><Data ss:Type="${type}">${escapeXml(cell)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Pedido">
  <Table>${xmlRows}</Table>
 </Worksheet>
</Workbook>`;
}

function publicBaseUrl(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function normalizeWhatsapp(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return digits;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    req.session = {};
    return res.status(401).json({ error: 'No autenticado' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    next();
  });
}

function sendHtmlIfAuth(file, role) {
  return (req, res) => {
    const user = getSessionUser(req);
    if (!user) return res.redirect('/login');
    if (role && user.role !== role) return res.redirect('/');
    res.sendFile(path.join(ROOT, file));
  };
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (IS_VERCEL) return 'lupo-vercel-change-SESSION_SECRET';
  return db.sessionSecret || 'lupo-dev-secret';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function encodeSession(data) {
  const payload = Buffer.from(JSON.stringify(data || {})).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function decodeSession(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return {};
  const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  const left = crypto.createHash('sha256').update(sig).digest();
  const right = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(left, right)) return {};
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function cookieSession(req, res, next) {
  req.session = decodeSession(parseCookies(req.headers.cookie)['lupo.sid']);
  const writeCookie = () => {
    const secure = IS_VERCEL || req.secure || req.get('x-forwarded-proto') === 'https';
    const flags = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
    if (!req.session?.username && !req.session?.userId) {
      res.append('Set-Cookie', `lupo.sid=; ${flags}; Max-Age=0`);
      return;
    }
    const payload = {
      username: req.session.username || getUserById(req.session.userId)?.username || null,
      userId: req.session.userId || null
    };
    res.append('Set-Cookie', `lupo.sid=${encodeSession(payload)}; ${flags}; Max-Age=${7 * 24 * 60 * 60}`);
  };
  const origJson = res.json.bind(res);
  const origRedirect = res.redirect.bind(res);
  const origSendFile = res.sendFile.bind(res);
  res.json = (...args) => { writeCookie(); return origJson(...args); };
  res.redirect = (...args) => { writeCookie(); return origRedirect(...args); };
  res.sendFile = (...args) => { writeCookie(); return origSendFile(...args); };
  next();
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use(cookieSession);

app.use('/orders', express.static(path.join(ROOT, 'orders')));
app.use('/assets/uploads', express.static(UPLOADS_DIR));
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use('/pdfs', express.static(path.join(ROOT, 'pdfs')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(ROOT, 'styles.css')));
app.get('/app.js', (req, res) => res.sendFile(path.join(ROOT, 'app.js')));
app.get('/logo.svg', (req, res) => res.sendFile(path.join(ROOT, 'logo.svg')));

app.get('/login', (req, res) => {
  const user = getSessionUser(req);
  if (user) return res.redirect(user.role === 'admin' ? '/admin' : '/');
  res.sendFile(path.join(ROOT, 'login.html'));
});
app.get('/', sendHtmlIfAuth('index.html'));
app.get('/brasil', sendHtmlIfAuth('index.html', 'admin'));
app.get('/brasil/pedido', sendHtmlIfAuth('pedido-brasil.html', 'admin'));
app.get('/admin', sendHtmlIfAuth('admin.html', 'admin'));

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.users.find(u => u.username.toLowerCase() === username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session = { username: user.username, userId: user.id };
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session = {};
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const list = getListById(req.user.priceListId);
  res.json({
    user: publicUser(req.user),
    priceListName: list ? list.name : null,
    whatsappNumber: normalizeWhatsapp(db.settings?.whatsappNumber)
  });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({
    whatsappNumber: db.settings?.whatsappNumber || ''
  });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const raw = String(req.body?.whatsappNumber || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (raw && !normalizeWhatsapp(digits)) {
    return res.status(400).json({ error: 'Ingresá un número de WhatsApp válido, con código de país. Ej: 54911...' });
  }
  db.settings = db.settings || {};
  db.settings.whatsappNumber = digits;
  saveDb(db);
  res.json({ whatsappNumber: db.settings.whatsappNumber });
});

app.post('/api/orders', requireAuth, (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  const notes = String(req.body?.notes || '').trim().slice(0, 800);
  if (!incoming.length) return res.status(400).json({ error: 'El pedido está vacío.' });
  if (incoming.length > 250) return res.status(400).json({ error: 'El pedido tiene demasiadas líneas.' });
  const items = [];
  for (const raw of incoming) {
    const code = String(raw?.code || '').trim().slice(0, 40);
    const qty = Math.max(1, Math.min(9999, parseInt(raw?.qty, 10) || 0));
    if (!code || !qty) continue;
    const price = Number(raw?.priceArs);
    items.push({
      code,
      name: String(raw?.name || '').trim().slice(0, 160),
      size: String(raw?.size || '').trim().slice(0, 40),
      colorCode: String(raw?.colorCode || '').trim().slice(0, 40),
      colorName: String(raw?.colorName || '').trim().slice(0, 80),
      qty,
      priceArs: Number.isFinite(price) ? price : null
    });
  }
  if (!items.length) return res.status(400).json({ error: 'No hay artículos válidos en el pedido.' });
  const token = crypto.randomBytes(16).toString('hex');
  const filename = `pedido-lupo-${new Date().toISOString().slice(0, 10)}-${token.slice(0, 6)}.xls`;
  const xml = buildOrderExcelXml({
    clientName: req.user.name || req.user.username,
    username: req.user.username,
    items,
    notes
  });
  fs.mkdirSync(ORDERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ORDERS_DIR, `${token}.xls`), xml, 'utf8');
  const excelUrl = `${publicBaseUrl(req)}/pedido/${token}`;
  const qtyTotal = items.reduce((sum, item) => sum + item.qty, 0);
  const moneyTotal = items.reduce((sum, item) => sum + (Number.isFinite(item.priceArs) ? item.priceArs * item.qty : 0), 0);
  const phone = normalizeWhatsapp(db.settings?.whatsappNumber);
  const message = [
    'Pedido Lupo',
    `Cliente: ${req.user.name || req.user.username}`,
    `Usuario: ${req.user.username}`,
    `${items.length} línea${items.length === 1 ? '' : 's'} · ${qtyTotal} unidad${qtyTotal === 1 ? '' : 'es'}`,
    moneyTotal ? `Total: ${moneyTotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}` : '',
    notes ? `Notas: ${notes}` : '',
    '',
    'Excel del pedido:',
    excelUrl
  ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== '')).join('\n').trim();
  const whatsappUrl = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : '';
  res.json({
    token,
    filename,
    excelUrl,
    whatsappUrl,
    message,
    xml
  });
});

function sendOrderExcel(req, res) {
  const token = String(req.params.token || '').replace(/[^a-f0-9]/gi, '');
  if (token.length < 16) return res.status(404).end();
  const file = path.join(ORDERS_DIR, `${token}.xls`);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pedido-lupo.xls"');
  res.sendFile(file);
}

app.get('/pedido/:token', sendOrderExcel);
app.get('/api/pedido/:token', sendOrderExcel);

app.get('/api/catalog', requireAuth, (req, res) => {
  const published = new Set(db.publishedIds);
  const list = getListById(req.user.priceListId);
  const prices = list && list.prices ? list.prices : {};
  const items = PRODUCTS
    .filter(p => published.has(p.id))
    .map(p => catalogProduct(p, prices[p.id]));
  res.json({
    products: items,
    catalogs: catalogSummaries(items),
    priceListName: list ? list.name : null
  });
});

app.get('/api/admin/catalog-brasil', requireAdmin, (req, res) => {
  const items = PRODUCTS.map(p => catalogProduct(p, null, { includeFob: true }));
  res.json({
    products: items,
    catalogs: catalogSummaries(items),
    mode: 'brasil'
  });
});

app.post('/api/admin/orders-brasil', requireAdmin, (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  const notes = String(req.body?.notes || '').trim().slice(0, 800);
  if (!incoming.length) return res.status(400).json({ error: 'El pedido está vacío.' });
  if (incoming.length > 250) return res.status(400).json({ error: 'El pedido tiene demasiadas líneas.' });
  const items = [];
  for (const raw of incoming) {
    const code = String(raw?.code || '').trim().slice(0, 40);
    const qty = Math.max(1, Math.min(9999, parseInt(raw?.qty, 10) || 0));
    if (!code || !qty) continue;
    const fob = Number(raw?.fobUsd);
    items.push({
      code,
      name: String(raw?.name || '').trim().slice(0, 160),
      size: String(raw?.size || '').trim().slice(0, 40),
      colorCode: String(raw?.colorCode || '').trim().slice(0, 40),
      colorName: String(raw?.colorName || '').trim().slice(0, 80),
      qty,
      fobUsd: Number.isFinite(fob) ? fob : null
    });
  }
  if (!items.length) return res.status(400).json({ error: 'No hay artículos válidos en el pedido.' });
  const token = crypto.randomBytes(16).toString('hex');
  const filename = `pedido-brasil-${new Date().toISOString().slice(0, 10)}-${token.slice(0, 6)}.xls`;
  const xml = buildOrderExcelXml({
    clientName: req.user.name || req.user.username,
    username: req.user.username,
    items,
    notes,
    currency: 'USD'
  });
  fs.mkdirSync(ORDERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ORDERS_DIR, `${token}.xls`), xml, 'utf8');
  const excelUrl = `${publicBaseUrl(req)}/pedido/${token}`;
  const qtyTotal = items.reduce((sum, item) => sum + item.qty, 0);
  const moneyTotal = items.reduce((sum, item) => sum + (Number.isFinite(item.fobUsd) ? item.fobUsd * item.qty : 0), 0);
  const phone = normalizeWhatsapp(db.settings?.whatsappNumber);
  const message = [
    'Pedido Lupo Brasil (FOB)',
    `Cliente: ${req.user.name || req.user.username}`,
    `Usuario: ${req.user.username}`,
    `${items.length} línea${items.length === 1 ? '' : 's'} · ${qtyTotal} unidad${qtyTotal === 1 ? '' : 'es'}`,
    moneyTotal ? `Total FOB: USD ${moneyTotal.toFixed(2)}` : '',
    notes ? `Notas: ${notes}` : '',
    '',
    'Excel del pedido:',
    excelUrl
  ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== '')).join('\n').trim();
  const whatsappUrl = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : '';
  res.json({
    token,
    filename,
    excelUrl,
    whatsappUrl,
    message,
    xml
  });
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json({
    products: PRODUCTS.map(productAdminView)
  });
});

app.get('/api/admin/catalogs', requireAdmin, (req, res) => {
  res.json({ catalogs: adminCatalogSummaries() });
});

app.patch('/api/admin/products/visibility', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const published = Boolean(req.body?.published);
  const valid = new Set(ids.filter(id => PRODUCT_BY_ID.has(id)));
  const current = new Set(db.publishedIds);
  if (published) valid.forEach(id => current.add(id));
  else valid.forEach(id => current.delete(id));
  db.publishedIds = PRODUCTS.map(p => p.id).filter(id => current.has(id));
  saveDb(db);
  res.json({ publishedCount: db.publishedIds.length });
});

app.patch('/api/admin/products/badges', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const badge = parseBadge(req.body?.badge);
  if (badge == null) return res.status(400).json({ error: 'Etiqueta inválida' });
  const badgeText = parseBadgeText(req.body?.badgeText);
  for (const id of ids) {
    if (!PRODUCT_BY_ID.has(id)) continue;
    setMeta(id, { badge, badgeText: badge ? badgeText : '' });
  }
  saveDb(db);
  res.json({ ok: true });
});

app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  const p = PRODUCT_BY_ID.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const patch = {};
  if (req.body?.badge != null) {
    const badge = parseBadge(req.body.badge);
    if (badge == null) return res.status(400).json({ error: 'Etiqueta inválida' });
    patch.badge = badge;
    if (!badge) patch.badgeText = '';
  }
  if (req.body?.badgeText != null) patch.badgeText = parseBadgeText(req.body.badgeText);
  if (req.body?.name != null) {
    const name = parseName(req.body.name);
    patch.name = !name || name === p.name ? '' : name;
  }
  setMeta(p.id, patch);
  saveDb(db);
  res.json({ product: productAdminView(p) });
});

app.post('/api/admin/products/:id/image', requireAdmin, async (req, res) => {
  try {
    const p = PRODUCT_BY_ID.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    const saved = await saveDataUrl(p.id, req.body?.dataUrl);
    if (saved.error) return res.status(400).json({ error: saved.error });
    await deleteUpload(getMeta(p.id).image);
    setMeta(p.id, { image: saved.path });
    saveDb(db);
    res.json({ product: productAdminView(p) });
  } catch (err) {
    console.error('POST product image', err);
    res.status(500).json({ error: err.message || 'No se pudo guardar la imagen.' });
  }
});

app.delete('/api/admin/products/:id/image', requireAdmin, async (req, res) => {
  try {
    const p = PRODUCT_BY_ID.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    await deleteUpload(getMeta(p.id).image);
    setMeta(p.id, { image: '' });
    saveDb(db);
    res.json({ product: productAdminView(p) });
  } catch (err) {
    console.error('DELETE product image', err);
    res.status(500).json({ error: err.message || 'No se pudo restaurar la imagen.' });
  }
});

app.post('/api/admin/products/:id/colors/:code/image', requireAdmin, async (req, res) => {
  try {
    const p = PRODUCT_BY_ID.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    const code = decodeURIComponent(String(req.params.code || '')).trim();
    const color = (p.colors || []).find(c => String(c.code) === code);
    if (!color) return res.status(404).json({ error: 'Color no encontrado' });
    const saved = await saveDataUrl(p.id, req.body?.dataUrl, code);
    if (saved.error) return res.status(400).json({ error: saved.error });
    const prev = (getMeta(p.id).colorImages || {})[code];
    await deleteUpload(prev);
    setColorImage(p.id, code, saved.path);
    saveDb(db);
    res.json({ product: productAdminView(p) });
  } catch (err) {
    console.error('POST color image', err);
    res.status(500).json({ error: err.message || 'No se pudo guardar la imagen del color.' });
  }
});

app.delete('/api/admin/products/:id/colors/:code/image', requireAdmin, async (req, res) => {
  try {
    const p = PRODUCT_BY_ID.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    const code = decodeURIComponent(String(req.params.code || '')).trim();
    const color = (p.colors || []).find(c => String(c.code) === code);
    if (!color) return res.status(404).json({ error: 'Color no encontrado' });
    const prev = (getMeta(p.id).colorImages || {})[code];
    await deleteUpload(prev);
    setColorImage(p.id, code, '');
    saveDb(db);
    res.json({ product: productAdminView(p) });
  } catch (err) {
    console.error('DELETE color image', err);
    res.status(500).json({ error: err.message || 'No se pudo restaurar la imagen del color.' });
  }
});

app.get('/api/admin/lists', requireAdmin, (req, res) => {
  res.json({
    lists: db.priceLists.map(list => ({
      id: list.id,
      name: list.name,
      pricedCount: Object.values(list.prices || {}).filter(v => Number.isFinite(v)).length
    }))
  });
});

app.get('/api/admin/lists/:id', requireAdmin, (req, res) => {
  const list = getListById(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista no encontrada' });
  res.json({
    list: {
      id: list.id,
      name: list.name,
      prices: list.prices || {}
    }
  });
});

app.post('/api/admin/lists', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const list = { id: uid(), name, prices: {} };
  db.priceLists.push(list);
  saveDb(db);
  res.json({ list: { id: list.id, name: list.name, pricedCount: 0 } });
});

app.patch('/api/admin/lists/:id', requireAdmin, (req, res) => {
  const list = getListById(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista no encontrada' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  list.name = name;
  saveDb(db);
  res.json({ list: { id: list.id, name: list.name } });
});

app.delete('/api/admin/lists/:id', requireAdmin, (req, res) => {
  if (db.priceLists.length <= 1) {
    return res.status(400).json({ error: 'Tiene que quedar al menos una lista' });
  }
  const index = db.priceLists.findIndex(l => l.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Lista no encontrada' });
  const fallback = db.priceLists.find((l, i) => i !== index);
  db.users.forEach(user => {
    if (user.priceListId === req.params.id) user.priceListId = fallback.id;
  });
  db.priceLists.splice(index, 1);
  saveDb(db);
  res.json({ ok: true });
});

app.patch('/api/admin/lists/:id/prices', requireAdmin, (req, res) => {
  const list = getListById(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista no encontrada' });
  if (!list.prices) list.prices = {};
  const incoming = req.body?.prices && typeof req.body.prices === 'object' ? req.body.prices : {};
  for (const [productId, value] of Object.entries(incoming)) {
    if (!PRODUCT_BY_ID.has(productId)) continue;
    const price = parseArs(value);
    if (price == null) delete list.prices[productId];
    else list.prices[productId] = price;
  }
  saveDb(db);
  res.json({
    pricedCount: Object.values(list.prices).filter(v => Number.isFinite(v)).length
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({
    users: db.users.map(u => ({
      ...publicUser(u),
      priceListName: getListById(u.priceListId)?.name || null
    }))
  });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim() || username;
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'cliente';
  const priceListId = String(req.body?.priceListId || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }
  if (db.users.some(u => u.username.toLowerCase() === username)) {
    return res.status(400).json({ error: 'Ese usuario ya existe' });
  }
  if (!getListById(priceListId)) {
    return res.status(400).json({ error: 'Lista de precios inválida' });
  }
  const user = {
    id: uid(),
    username,
    name,
    passwordHash: hashPassword(password),
    role,
    priceListId
  };
  db.users.push(user);
  saveDb(db);
  res.json({ user: publicUser(user) });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (req.body?.name != null) user.name = String(req.body.name).trim() || user.username;
  if (req.body?.role) {
    const role = req.body.role === 'admin' ? 'admin' : 'cliente';
    if (user.role === 'admin' && role !== 'admin') {
      const admins = db.users.filter(u => u.role === 'admin');
      if (admins.length <= 1) {
        return res.status(400).json({ error: 'Tiene que quedar al menos un administrador' });
      }
    }
    user.role = role;
  }
  if (req.body?.priceListId) {
    if (!getListById(req.body.priceListId)) {
      return res.status(400).json({ error: 'Lista de precios inválida' });
    }
    user.priceListId = req.body.priceListId;
  }
  if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 4) return res.status(400).json({ error: 'La contraseña es demasiado corta' });
    user.passwordHash = hashPassword(password);
  }
  saveDb(db);
  res.json({ user: publicUser(user) });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const index = db.users.findIndex(u => u.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  const user = db.users[index];
  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
  }
  if (user.role === 'admin') {
    const admins = db.users.filter(u => u.role === 'admin');
    if (admins.length <= 1) {
      return res.status(400).json({ error: 'Tiene que quedar al menos un administrador' });
    }
  }
  db.users.splice(index, 1);
  saveDb(db);
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Catálogo Lupo B2B en http://localhost:${PORT}`);
    console.log('Admin: admin / admin123');
    console.log('Cliente: cliente / cliente123');
  });
}

module.exports = app;
