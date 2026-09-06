const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');
const express = require('express');
const {
  USE_SUPABASE,
  fetchAppState,
  upsertAppState,
  uploadPublicFile,
  removePublicFile,
  saveOrder,
  getOrder
} = require('./lib/supabase');

const ROOT = __dirname;
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? '/tmp' : ROOT;
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = IS_VERCEL ? path.join('/tmp', 'uploads') : path.join(ROOT, 'assets', 'uploads');
const ORDERS_DIR = path.join(DATA_DIR, 'orders');
const PORT = Number(process.env.PORT) || 3000;
const LINGERIE_CATALOGS = new Set(['Lencería 2026', 'Lupo Lingerie PV 2026']);
const DEFAULT_LABELS = [
  { id: 'promo', name: 'Promoción', color: '#6b99de', promoTab: true },
  { id: 'last', name: 'Últimas unidades', color: '#111111', promoTab: false },
  { id: 'sale', name: 'Liquidación', color: '#c45c00', promoTab: true }
];

if (IS_VERCEL && !USE_SUPABASE) {
  console.warn('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY: en Vercel la data no va a persistir.');
}

function loadProducts() {
  const code = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return Array.isArray(context.window.PRODUCTS) ? context.window.PRODUCTS : [];
}

const PRODUCTS = loadProducts();
const PRODUCT_BY_ID = new Map(PRODUCTS.map(p => [p.id, p]));
const LOCAL_CATALOGS = new Set([
  'Boxers y Slips 2026',
  'Lencería 2026',
  'Medias 2026',
  'Lupo Pijamas Invierno',
  'Lupo Pijamas Verano'
]);

function productOrigin(p) {
  const pdf = String(p?.pdf || '').replace(/\\/g, '/');
  if (pdf.includes('nuevos-catalogos')) return 'local';
  if (LOCAL_CATALOGS.has(p?.catalog)) return 'local';
  return 'brasil';
}

function isLocalProduct(p) {
  return productOrigin(p) === 'local';
}

function defaultPublishedIds() {
  return PRODUCTS.filter(isLocalProduct).map(p => p.id);
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
    settings: { whatsappNumber: '' },
    customLabels: defaultCustomLabels()
  };
}

function defaultCustomLabels() {
  return DEFAULT_LABELS.map(l => ({ ...l }));
}

function normalizeCustomLabels(raw) {
  if (!Array.isArray(raw) || !raw.length) return defaultCustomLabels();
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item?.id || '').trim().slice(0, 40);
    const name = String(item?.name || '').trim().slice(0, 40);
    const color = parseLabelColor(item?.color);
    if (!id || !name || !color || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, color, promoTab: Boolean(item?.promoTab) });
  }
  return out.length ? out : defaultCustomLabels();
}

function parseLabelColor(raw) {
  const value = String(raw || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return null;
}

function slugLabelId(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'etiqueta';
  let id = base;
  let n = 2;
  while ((db.customLabels || []).some(l => l.id === id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

function labelById(id) {
  return (db.customLabels || []).find(l => l.id === id) || null;
}

function catalogSortKey(catalogName) {
  return LINGERIE_CATALOGS.has(catalogName) ? 0 : 1;
}

function sortCatalogSummaries(summaries) {
  return [...summaries].sort((a, b) => {
    const diff = catalogSortKey(a.catalog) - catalogSortKey(b.catalog);
    if (diff) return diff;
    return String(a.catalog || '').localeCompare(String(b.catalog || ''), 'es');
  });
}

function normalizeDb(parsed) {
  const data = parsed && typeof parsed === 'object' ? parsed : seedDb();
  data.publishedIds = Array.isArray(data.publishedIds) ? data.publishedIds : [];
  data.priceLists = Array.isArray(data.priceLists) ? data.priceLists : [];
  data.users = Array.isArray(data.users) ? data.users : [];
  data.productMeta = data.productMeta && typeof data.productMeta === 'object' ? data.productMeta : {};
  data.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  if (typeof data.settings.whatsappNumber !== 'string') data.settings.whatsappNumber = '';
  data.customLabels = normalizeCustomLabels(data.customLabels);
  if (!data.sessionSecret) data.sessionSecret = crypto.randomBytes(24).toString('hex');
  const validIds = new Set(PRODUCTS.map(p => p.id));
  data.publishedIds = data.publishedIds.filter(id => validIds.has(id));
  for (const id of Object.keys(data.productMeta)) {
    if (!validIds.has(id)) delete data.productMeta[id];
  }
  if (!data.publishedIds.length) data.publishedIds = defaultPublishedIds();
  for (const list of data.priceLists) {
    if (!list.prices || typeof list.prices !== 'object') list.prices = {};
    for (const id of Object.keys(list.prices)) {
      if (!validIds.has(id)) delete list.prices[id];
    }
  }
  const agostoPath = path.join(ROOT, 'agosto-2026-capital-prices.json');
  const seedPath = fs.existsSync(agostoPath) ? agostoPath : path.join(ROOT, 'multilupo-prices.json');
  const mayorista = data.priceLists.find(l => l.id === 'lista-mayorista') || data.priceLists[0];
  if (mayorista && Object.keys(mayorista.prices).length === 0 && fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    for (const [id, price] of Object.entries(seed)) {
      if (validIds.has(id) && Number.isFinite(price)) mayorista.prices[id] = price;
    }
    if (fs.existsSync(agostoPath)) mayorista.name = 'Agosto 2026 Capital';
  }
  if (!data.users.length) {
    const seeded = seedDb();
    data.users = seeded.users;
    if (!data.priceLists.length) data.priceLists = seeded.priceLists;
  }
  return data;
}

function loadDbFromFile() {
  if (!fs.existsSync(DB_PATH)) return normalizeDb(seedDb());
  return normalizeDb(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
}

function saveDbToFile(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

async function loadDb() {
  if (USE_SUPABASE) {
    const remote = await fetchAppState();
    const data = normalizeDb(remote || seedDb());
    if (!remote) await upsertAppState(data);
    return data;
  }
  if (IS_VERCEL) {
    throw new Error('Configurá SUPABASE_URL y SUPABASE_SECRET_KEY en Vercel.');
  }
  const data = loadDbFromFile();
  saveDbToFile(data);
  return data;
}

async function saveDb(data) {
  db = data;
  try {
    if (USE_SUPABASE) {
      await upsertAppState(data);
      return;
    }
    if (IS_VERCEL) {
      console.warn('saveDb: sin Supabase en Vercel, no se persistió.');
      return;
    }
    saveDbToFile(data);
  } catch (err) {
    console.warn('No se pudo guardar la base:', err.message);
    throw err;
  }
}

let db = seedDb();
const dbReady = loadDb()
  .then(data => {
    db = data;
    return db;
  })
  .catch(err => {
    console.error('No se pudo cargar la base:', err.message);
    throw err;
  });

function isStaticAssetPath(urlPath) {
  return /^\/(assets|js|pdfs|orders)\//.test(urlPath)
    || urlPath === '/styles.css'
    || urlPath === '/app.js'
    || urlPath === '/logo.svg';
}

function sendGzipJson(req, res, payload) {
  const json = JSON.stringify(payload);
  const accept = String(req.headers['accept-encoding'] || '');
  if (json.length > 1024 && /gzip/i.test(accept)) {
    const body = zlib.gzipSync(json, { level: 6 });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    return res.send(body);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(json);
}

async function ensureDb(req, res, next) {
  if (isStaticAssetPath(req.path)) return next();
  try {
    await dbReady;
    next();
  } catch (err) {
    console.error(err);
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({ error: 'Base de datos no disponible. Revisá Supabase.' });
    }
    res.status(503).send('Base de datos no disponible. Revisá SUPABASE_URL y SUPABASE_SECRET_KEY.');
  }
}

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

function sizesFromValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return ['Único'];
  let parts = raw.split(/\s*[•·|]\s*/).map(x => x.trim()).filter(Boolean);
  if (parts.length === 1 && /[\/,]/.test(parts[0]) && !/\d/.test(parts[0])) {
    parts = parts[0].split(/[\/,]/).map(x => x.trim()).filter(Boolean);
  }
  return parts.length ? parts : ['Único'];
}

function stockKey(size, colorCode) {
  return `${String(size || '').trim()}|${String(colorCode || '').trim()}`;
}

function parseStockMap(raw, product) {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const sizes = new Set(sizesFromValue(product?.sizes));
  const colors = (product?.colors || []).map(c => String(c.code || '').trim()).filter(Boolean);
  const colorSet = new Set(colors.length ? colors : ['-']);
  const cleaned = {};
  for (const [key, value] of Object.entries(raw)) {
    const parts = String(key).split('|');
    if (parts.length < 2) continue;
    const size = parts[0].trim();
    const colorCode = parts.slice(1).join('|').trim();
    if (!sizes.has(size) || !colorSet.has(colorCode)) continue;
    if (value === '' || value == null) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    cleaned[stockKey(size, colorCode)] = Math.max(0, Math.min(999999, Math.round(n)));
  }
  return cleaned;
}

function setMeta(id, patch) {
  if (!db.productMeta) db.productMeta = {};
  const current = { ...(db.productMeta[id] || {}), ...patch };
  if (!current.image) delete current.image;
  if (!current.name) delete current.name;
  if (!current.badge) delete current.badge;
  if (!current.badgeText) delete current.badgeText;
  if (!Number.isFinite(current.sortOrder)) delete current.sortOrder;
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
  if (current.stock && typeof current.stock === 'object' && !Array.isArray(current.stock)) {
    const cleaned = {};
    for (const [key, value] of Object.entries(current.stock)) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      cleaned[String(key)] = Math.max(0, Math.min(999999, Math.round(n)));
    }
    if (Object.keys(cleaned).length) current.stock = cleaned;
    else delete current.stock;
  } else {
    delete current.stock;
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

  if (USE_SUPABASE) {
    try {
      const url = await uploadPublicFile(filename, buf, contentType);
      return { path: url };
    } catch (err) {
      return { error: `No se pudo guardar la imagen: ${err.message}` };
    }
  }

  if (IS_VERCEL) {
    return {
      error: 'En Vercel las fotos necesitan Supabase Storage (SUPABASE_URL + SUPABASE_SECRET_KEY).'
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
    if (!USE_SUPABASE) return;
    try { await removePublicFile(rel); } catch {}
    return;
  }
  if (!rel.startsWith('assets/uploads/')) return;
  const filename = path.basename(rel);
  const abs = path.join(UPLOADS_DIR, filename);
  if (abs.startsWith(UPLOADS_DIR) && fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch {}
  }
}

async function persistOrder(token, filename, xml) {
  if (USE_SUPABASE) {
    await saveOrder(token, filename, xml);
    return;
  }
  if (IS_VERCEL) {
    throw new Error('Pedidos en Vercel requieren Supabase.');
  }
  fs.mkdirSync(ORDERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ORDERS_DIR, `${token}.xls`), xml, 'utf8');
}

async function readOrder(token) {
  if (USE_SUPABASE) {
    return getOrder(token);
  }
  const file = path.join(ORDERS_DIR, `${token}.xls`);
  if (!fs.existsSync(file)) return null;
  return {
    token,
    filename: 'pedido-lupo.xls',
    content: fs.readFileSync(file, 'utf8')
  };
}

function parseBadge(raw) {
  const badge = String(raw || '').trim();
  if (!badge) return '';
  return labelById(badge) ? badge : null;
}

function clearLabelFromProducts(labelId) {
  for (const id of Object.keys(db.productMeta || {})) {
    if (db.productMeta[id]?.badge === labelId) {
      setMeta(id, { badge: '', badgeText: '' });
    }
  }
}

function parseBadgeText(raw) {
  return String(raw || '').trim().slice(0, 40);
}

function parseSortOrder(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(999999, Math.round(n)));
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
    origin: productOrigin(p),
    pdf: p.pdf || null,
    page: p.page || null,
    image: resolvedImage(p),
    originalImage: p.image,
    hasCustomImage: Boolean(meta.image),
    colors: resolvedColors(p),
    sizes: p.sizes || '',
    stock: meta.stock && typeof meta.stock === 'object' ? meta.stock : {},
    badge: meta.badge || '',
    badgeText: meta.badgeText || '',
    sortOrder: Number.isFinite(meta.sortOrder) ? meta.sortOrder : null,
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
  return sortCatalogSummaries([...map.values()]);
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
    stock: meta.stock && typeof meta.stock === 'object' ? meta.stock : {},
    description: p.description || '',
    tech: p.tech || [],
    badge: meta.badge || '',
    badgeText: meta.badgeText || '',
    sortOrder: Number.isFinite(meta.sortOrder) ? meta.sortOrder : null,
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

const IVA_RATE = 0.21;

function orderTotalsArs(items) {
  const subtotal = items.reduce((sum, item) => {
    if (!Number.isFinite(item.priceArs)) return sum;
    return sum + item.priceArs * Number(item.qty || 0);
  }, 0);
  const iva = Math.round(subtotal * IVA_RATE * 100) / 100;
  const total = Math.round((subtotal + iva) * 100) / 100;
  return { subtotal, iva, total };
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
    ['Unidades', String(qtyTotal)]
  ];
  if (isFob) {
    info.push([totalLabel, formatMoneyPlain(moneyTotal)]);
  } else {
    const { subtotal, iva, total } = orderTotalsArs(items);
    info.push(
      ['Subtotal ARS', formatMoneyPlain(subtotal)],
      ['IVA 21%', formatMoneyPlain(iva)],
      ['Total con IVA', formatMoneyPlain(total)]
    );
  }
  info.push(['Notas', notes || '']);
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
  const origSend = res.send.bind(res);
  let written = false;
  const writeOnce = () => {
    if (written) return;
    written = true;
    writeCookie();
  };
  res.json = (...args) => { writeOnce(); return origJson(...args); };
  res.redirect = (...args) => { writeOnce(); return origRedirect(...args); };
  res.sendFile = (...args) => { writeOnce(); return origSendFile(...args); };
  res.send = (...args) => { writeOnce(); return origSend(...args); };
  next();
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use(ensureDb);
app.use(cookieSession);

const staticImageHeaders = {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(jpe?g|png|webp|gif|svg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=86400');
    }
  }
};
app.use('/orders', express.static(path.join(ROOT, 'orders')));
app.use('/assets/uploads', express.static(UPLOADS_DIR, staticImageHeaders));
app.use('/assets', express.static(path.join(ROOT, 'assets'), staticImageHeaders));
app.use('/pdfs', express.static(path.join(ROOT, 'pdfs'), { maxAge: '7d' }));
app.use('/js', express.static(path.join(ROOT, 'js'), { maxAge: '1d' }));
app.get('/styles.css', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(ROOT, 'styles.css'));
});
app.get('/app.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(ROOT, 'app.js'));
});
app.get('/logo.svg', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(path.join(ROOT, 'logo.svg'));
});

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

app.patch('/api/admin/settings', requireAdmin, async (req, res) => {
  const raw = String(req.body?.whatsappNumber || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (raw && !normalizeWhatsapp(digits)) {
    return res.status(400).json({ error: 'Ingresá un número de WhatsApp válido, con código de país. Ej: 54911...' });
  }
  db.settings = db.settings || {};
  db.settings.whatsappNumber = digits;
  await saveDb(db);
  res.json({ whatsappNumber: db.settings.whatsappNumber });
});

app.get('/api/admin/labels', requireAdmin, (req, res) => {
  res.json({ labels: db.customLabels || [] });
});

app.post('/api/admin/labels', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const color = parseLabelColor(req.body?.color);
  if (!name) return res.status(400).json({ error: 'Ingresá un nombre para la etiqueta.' });
  if (!color) return res.status(400).json({ error: 'Color inválido.' });
  db.customLabels = db.customLabels || defaultCustomLabels();
  const id = slugLabelId(name);
  const label = { id, name, color, promoTab: Boolean(req.body?.promoTab) };
  db.customLabels.push(label);
  await saveDb(db);
  res.json({ label, labels: db.customLabels });
});

app.patch('/api/admin/labels/:id', requireAdmin, async (req, res) => {
  const label = labelById(req.params.id);
  if (!label) return res.status(404).json({ error: 'Etiqueta no encontrada' });
  if (req.body?.name != null) {
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
    label.name = name;
  }
  if (req.body?.color != null) {
    const color = parseLabelColor(req.body.color);
    if (!color) return res.status(400).json({ error: 'Color inválido.' });
    label.color = color;
  }
  if (req.body?.promoTab != null) label.promoTab = Boolean(req.body.promoTab);
  await saveDb(db);
  res.json({ label, labels: db.customLabels });
});

app.delete('/api/admin/labels/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!labelById(id)) return res.status(404).json({ error: 'Etiqueta no encontrada' });
  db.customLabels = (db.customLabels || []).filter(l => l.id !== id);
  if (!db.customLabels.length) db.customLabels = defaultCustomLabels();
  clearLabelFromProducts(id);
  await saveDb(db);
  res.json({ labels: db.customLabels });
});

function parseMayoristaOrderItems(incoming) {
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
  return items;
}

function parseBrasilOrderItems(incoming) {
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
  return items;
}

function validateOrderInput(incoming, items) {
  if (!incoming.length) return 'El pedido está vacío.';
  if (incoming.length > 250) return 'El pedido tiene demasiadas líneas.';
  if (!items.length) return 'No hay artículos válidos en el pedido.';
  return '';
}

app.post('/api/orders', requireAuth, async (req, res) => {
  try {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  const notes = String(req.body?.notes || '').trim().slice(0, 800);
  const items = parseMayoristaOrderItems(incoming);
  const validationError = validateOrderInput(incoming, items);
  if (validationError) return res.status(400).json({ error: validationError });
  const token = crypto.randomBytes(16).toString('hex');
  const filename = `pedido-lupo-${new Date().toISOString().slice(0, 10)}-${token.slice(0, 6)}.xls`;
  const xml = buildOrderExcelXml({
    clientName: req.user.name || req.user.username,
    username: req.user.username,
    items,
    notes
  });
  await persistOrder(token, filename, xml);
  const excelUrl = `${publicBaseUrl(req)}/pedido/${token}`;
  const qtyTotal = items.reduce((sum, item) => sum + item.qty, 0);
  const { subtotal, iva, total } = orderTotalsArs(items);
  const phone = normalizeWhatsapp(db.settings?.whatsappNumber);
  const message = [
    'Pedido Lupo',
    `Cliente: ${req.user.name || req.user.username}`,
    `Usuario: ${req.user.username}`,
    `${items.length} línea${items.length === 1 ? '' : 's'} · ${qtyTotal} unidad${qtyTotal === 1 ? '' : 'es'}`,
    subtotal ? `Subtotal: ${subtotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}` : '',
    subtotal ? `IVA 21%: ${iva.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}` : '',
    subtotal ? `Total con IVA: ${total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}` : '',
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
  } catch (err) {
    console.error('POST /api/orders', err);
    res.status(500).json({ error: err.message || 'No se pudo guardar el pedido.' });
  }
});

app.post('/api/orders/export', requireAuth, (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
    const notes = String(req.body?.notes || '').trim().slice(0, 800);
    const items = parseMayoristaOrderItems(incoming);
    const validationError = validateOrderInput(incoming, items);
    if (validationError) return res.status(400).json({ error: validationError });
    const filename = `pedido-lupo-${new Date().toISOString().slice(0, 10)}.xls`;
    const xml = buildOrderExcelXml({
      clientName: req.user.name || req.user.username,
      username: req.user.username,
      items,
      notes
    });
    res.json({ filename, xml });
  } catch (err) {
    console.error('POST /api/orders/export', err);
    res.status(500).json({ error: err.message || 'No se pudo exportar el pedido.' });
  }
});

async function sendOrderExcel(req, res) {
  try {
    const token = String(req.params.token || '').replace(/[^a-f0-9]/gi, '');
    if (token.length < 16) return res.status(404).end();
    const order = await readOrder(token);
    if (!order?.content) return res.status(404).end();
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${order.filename || 'pedido-lupo.xls'}"`);
    res.send(order.content);
  } catch (err) {
    console.error('sendOrderExcel', err);
    res.status(500).end();
  }
}

app.get('/pedido/:token', sendOrderExcel);
app.get('/api/pedido/:token', sendOrderExcel);

app.get('/api/catalog', requireAuth, (req, res) => {
  const published = new Set(db.publishedIds);
  const list = getListById(req.user.priceListId);
  const prices = list && list.prices ? list.prices : {};
  const items = PRODUCTS
    .filter(p => isLocalProduct(p) && published.has(p.id))
    .map(p => catalogProduct(p, prices[p.id]));
  sendGzipJson(req, res, {
    products: items,
    catalogs: catalogSummaries(items),
    labels: db.customLabels || [],
    priceListName: list ? list.name : null
  });
});

app.get('/api/admin/catalog-brasil', requireAdmin, (req, res) => {
  const items = PRODUCTS.map(p => catalogProduct(p, null, { includeFob: true }));
  sendGzipJson(req, res, {
    products: items,
    catalogs: catalogSummaries(items),
    labels: db.customLabels || [],
    mode: 'brasil'
  });
});

app.post('/api/admin/orders-brasil', requireAdmin, async (req, res) => {
  try {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  const notes = String(req.body?.notes || '').trim().slice(0, 800);
  const items = parseBrasilOrderItems(incoming);
  const validationError = validateOrderInput(incoming, items);
  if (validationError) return res.status(400).json({ error: validationError });
  const token = crypto.randomBytes(16).toString('hex');
  const filename = `pedido-brasil-${new Date().toISOString().slice(0, 10)}-${token.slice(0, 6)}.xls`;
  const xml = buildOrderExcelXml({
    clientName: req.user.name || req.user.username,
    username: req.user.username,
    items,
    notes,
    currency: 'USD'
  });
  await persistOrder(token, filename, xml);
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
  } catch (err) {
    console.error('POST /api/admin/orders-brasil', err);
    res.status(500).json({ error: err.message || 'No se pudo guardar el pedido.' });
  }
});

app.post('/api/admin/orders-brasil/export', requireAdmin, (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
    const notes = String(req.body?.notes || '').trim().slice(0, 800);
    const items = parseBrasilOrderItems(incoming);
    const validationError = validateOrderInput(incoming, items);
    if (validationError) return res.status(400).json({ error: validationError });
    const filename = `pedido-brasil-${new Date().toISOString().slice(0, 10)}.xls`;
    const xml = buildOrderExcelXml({
      clientName: req.user.name || req.user.username,
      username: req.user.username,
      items,
      notes,
      currency: 'USD'
    });
    res.json({ filename, xml });
  } catch (err) {
    console.error('POST /api/admin/orders-brasil/export', err);
    res.status(500).json({ error: err.message || 'No se pudo exportar el pedido.' });
  }
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  sendGzipJson(req, res, {
    products: PRODUCTS.map(productAdminView)
  });
});

app.get('/api/admin/catalogs', requireAdmin, (req, res) => {
  res.json({ catalogs: adminCatalogSummaries() });
});

app.patch('/api/admin/products/visibility', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const published = Boolean(req.body?.published);
  const valid = new Set(ids.filter(id => {
    const product = PRODUCT_BY_ID.get(id);
    return product && isLocalProduct(product);
  }));
  const current = new Set(db.publishedIds);
  if (published) valid.forEach(id => current.add(id));
  else valid.forEach(id => current.delete(id));
  db.publishedIds = PRODUCTS.map(p => p.id).filter(id => current.has(id));
  await saveDb(db);
  res.json({ publishedCount: db.publishedIds.length });
});

app.patch('/api/admin/products/badges', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const badge = parseBadge(req.body?.badge);
  if (badge == null) return res.status(400).json({ error: 'Etiqueta inválida' });
  const badgeText = parseBadgeText(req.body?.badgeText);
  for (const id of ids) {
    if (!PRODUCT_BY_ID.has(id)) continue;
    setMeta(id, { badge, badgeText: badge ? badgeText : '' });
  }
  await saveDb(db);
  res.json({ ok: true });
});

app.patch('/api/admin/products/:id', requireAdmin, async (req, res) => {
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
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sortOrder')) {
    const sortOrder = parseSortOrder(req.body.sortOrder);
    if (sortOrder === undefined) return res.status(400).json({ error: 'Orden inválido' });
    patch.sortOrder = sortOrder == null ? null : sortOrder;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'stock')) {
    const stock = parseStockMap(req.body.stock, p);
    if (stock === null) return res.status(400).json({ error: 'Stock inválido' });
    if (stock !== undefined) patch.stock = stock;
  }
  setMeta(p.id, patch);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'published') && isLocalProduct(p)) {
    const published = Boolean(req.body.published);
    const current = new Set(db.publishedIds);
    if (published) current.add(p.id);
    else current.delete(p.id);
    db.publishedIds = PRODUCTS.map(item => item.id).filter(id => current.has(id));
  }
  await saveDb(db);
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
    await saveDb(db);
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
    await saveDb(db);
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
    await saveDb(db);
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
    await saveDb(db);
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

app.post('/api/admin/lists', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const list = { id: uid(), name, prices: {} };
  db.priceLists.push(list);
  await saveDb(db);
  res.json({ list: { id: list.id, name: list.name, pricedCount: 0 } });
});

app.patch('/api/admin/lists/:id', requireAdmin, async (req, res) => {
  const list = getListById(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista no encontrada' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  list.name = name;
  await saveDb(db);
  res.json({ list: { id: list.id, name: list.name } });
});

app.delete('/api/admin/lists/:id', requireAdmin, async (req, res) => {
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
  await saveDb(db);
  res.json({ ok: true });
});

app.patch('/api/admin/lists/:id/prices', requireAdmin, async (req, res) => {
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
  await saveDb(db);
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

app.post('/api/admin/users', requireAdmin, async (req, res) => {
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
  await saveDb(db);
  res.json({ user: publicUser(user) });
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
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
  await saveDb(db);
  res.json({ user: publicUser(user) });
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
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
  await saveDb(db);
  res.json({ ok: true });
});

if (require.main === module) {
  dbReady
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Catálogo Lupo B2B en http://localhost:${PORT}`);
        console.log(USE_SUPABASE ? 'Persistencia: Supabase' : 'Persistencia: db.json local');
        console.log('Admin: admin / admin123');
        console.log('Cliente: cliente / cliente123');
      });
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = app;
