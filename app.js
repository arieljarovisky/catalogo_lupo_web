const { escapeHtml, translateText, normalizeText, formatArs, formatFob, api, logout, catalogLabel, setCustomLabels, getCustomLabels, badgeInfo, badgeLabel, badgeStyle, isPromoLabel, sizesFrom, stockQty } = window.LupoCommon;

const state = { search: '', codes: '', catalog: '', category: '', size: '', color: '', badge: '', view: 'grid', promos: false };
const $ = id => document.getElementById(id);
const SURTIDO_SIZE = 'Surtido';
const SURTIDO_COLOR = 'SURTIDO';
const SURTIDO_COLOR_NAME = 'Colores surtido';
const PROMOS_NAV = '__promos__';
const LINGERIE_CATALOGS = new Set(['Lencería 2026', 'Lupo Lingerie PV 2026']);
const TEXT_SCALES = ['md', 'lg', 'xl'];
const brasilMode = (() => {
  const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/brasil') return true;
  return new URLSearchParams(location.search).get('pedido') === 'brasil';
})();
let products = [];
let currentUser = null;
let cart = [];
let cartNotes = '';
let cartMsgTimer = null;
let whatsappNumber = '';
let modalProduct = null;

function cartStorageKey() {
  const mode = brasilMode ? 'brasil' : 'mayorista';
  return `lupo-cart-v2-${mode}-${currentUser?.username || 'anon'}`;
}
function notesStorageKey() {
  const mode = brasilMode ? 'brasil' : 'mayorista';
  return `lupo-cart-notes-v1-${mode}-${currentUser?.username || 'anon'}`;
}
function textScaleKey() {
  return 'lupo-text-scale';
}
function getCodes(v) {
  return normalizeText(v).split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
}
function unique(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}
function opt(select, values, label, translate = translateText) {
  select.innerHTML = `<option value="">${label}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(translate(v))}</option>`).join('');
}
function colorLabel(c) {
  const name = translateText(c.name || '').trim();
  if (name) return name;
  const code = String(c.code || '').trim();
  return !code || code === '-' ? 'Sin color' : code;
}
function productColorNames(p) {
  const seen = new Set();
  const names = [];
  for (const c of p?.colors || []) {
    const label = colorLabel(c);
    if (!label || label === 'Sin color') continue;
    const key = normalizeText(label);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(label);
  }
  return names;
}
function productDisplayName(p) {
  const base = translateText(p?.name || '').trim() || p?.code || '';
  const colors = productColorNames(p);
  if (!colors.length) return base;
  return `${base} · ${colors.join(', ')}`;
}
function productImage(p) {
  return assetUrl(p && p.image);
}
function assetUrl(src) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  const path = value.startsWith('/') ? value : `/${value}`;
  return path.includes('?') ? path : `${path}?v=6`;
}
function colorPhoto(c) {
  return assetUrl(c && c.image);
}
function isAdmin() {
  return currentUser?.role === 'admin';
}
function selectedColorCode() {
  const code = $('cartColor')?.value || '';
  if (!code || code === SURTIDO_COLOR || code === '-') return '';
  return code;
}
function syncModalPhotoEdit() {
  const wrap = $('modalPhotoEdit');
  if (!wrap) return;
  if (!isAdmin() || !modalProduct) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const code = selectedColorCode();
  const color = code ? (modalProduct.colors || []).find(c => String(c.code) === code) : null;
  const hint = $('modalPhotoHint');
  const restore = $('modalRestorePhotoBtn');
  if (color) {
    hint.textContent = `Foto del color: ${colorLabel(color)}`;
    restore.hidden = !color.hasCustomImage;
  } else {
    hint.textContent = 'Foto principal del producto';
    restore.hidden = !modalProduct.hasCustomImage;
  }
}
function applyProductUpdate(updated) {
  if (!updated?.id) return;
  const idx = products.findIndex(p => p.id === updated.id);
  if (idx < 0) return;
  const prev = products[idx];
  products[idx] = {
    ...prev,
    image: updated.image || prev.image,
    name: updated.name || prev.name,
    hasCustomImage: Boolean(updated.hasCustomImage),
    colors: (updated.colors || prev.colors || []).map(c => ({
      code: c.code,
      name: c.name,
      image: c.image,
      hasCustomImage: Boolean(c.hasCustomImage)
    })),
    badge: updated.badge != null ? updated.badge : prev.badge,
    badgeText: updated.badgeText != null ? updated.badgeText : prev.badgeText,
    stock: updated.stock != null ? updated.stock : prev.stock
  };
  if (modalProduct?.id === updated.id) {
    modalProduct = products[idx];
    const code = selectedColorCode();
    const color = code ? modalProduct.colors.find(c => String(c.code) === code) : null;
    $('modalImage').src = colorPhoto(color) || productImage(modalProduct);
    $('cartColorChips').querySelectorAll('.choice-chip').forEach(btn => {
      if (btn.dataset.color === SURTIDO_COLOR) return;
      const match = modalProduct.colors.find(c => String(c.code) === btn.dataset.color);
      if (match) btn.dataset.image = colorPhoto(match) || '';
    });
    syncModalPhotoEdit();
  }
  render();
}
async function readImageFile(file) {
  if (!file) throw new Error('Elegí una imagen.');
  if (file.size > 6 * 1024 * 1024) throw new Error('La imagen no puede superar 6 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}
async function uploadModalPhoto(file) {
  if (!modalProduct || !isAdmin()) return;
  const dataUrl = await readImageFile(file);
  const code = selectedColorCode();
  const url = code
    ? `/api/admin/products/${modalProduct.id}/colors/${encodeURIComponent(code)}/image`
    : `/api/admin/products/${modalProduct.id}/image`;
  const data = await api(url, { method: 'POST', body: { dataUrl } });
  applyProductUpdate(data.product);
  showCartMsg(code ? 'Foto del color actualizada.' : 'Foto del producto actualizada.');
}
async function restoreModalPhoto() {
  if (!modalProduct || !isAdmin()) return;
  const code = selectedColorCode();
  const url = code
    ? `/api/admin/products/${modalProduct.id}/colors/${encodeURIComponent(code)}/image`
    : `/api/admin/products/${modalProduct.id}/image`;
  const data = await api(url, { method: 'DELETE' });
  applyProductUpdate(data.product);
  showCartMsg('Se restauró la foto original.');
}
function selectCatalog(catalogName) {
  if (catalogName === PROMOS_NAV) {
    state.promos = true;
    $('catalogFilter').value = '';
    setActiveCatalog(PROMOS_NAV);
  } else {
    state.promos = false;
    $('catalogFilter').value = catalogName || '';
    setActiveCatalog(catalogName || '');
  }
  syncState();
  render();
}
function setActiveCatalog(catalogName) {
  document.querySelectorAll('#mainNav [data-catalog]').forEach(btn => {
    const key = btn.dataset.catalog || '';
    const active = state.promos ? key === PROMOS_NAV : key === (catalogName || '') && key !== PROMOS_NAV;
    btn.classList.toggle('active', active);
  });
}
function buildCatalogNav(catalogs) {
  const nav = $('mainNav');
  if (!nav) return;
  const sorted = [...catalogs].sort((a, b) => {
    const al = LINGERIE_CATALOGS.has(a.catalog) ? 0 : 1;
    const bl = LINGERIE_CATALOGS.has(b.catalog) ? 0 : 1;
    if (al !== bl) return al - bl;
    return catalogLabel(a.catalog).localeCompare(catalogLabel(b.catalog), 'es');
  });
  nav.innerHTML = `<button type="button" data-catalog="" class="active">Todos</button>` +
    `<button type="button" data-catalog="${PROMOS_NAV}">Promociones</button>` +
    sorted.map(c => `<button type="button" data-catalog="${escapeHtml(c.catalog)}">${escapeHtml(catalogLabel(c.catalog))}</button>`).join('');
  nav.querySelectorAll('[data-catalog]').forEach(btn => {
    btn.addEventListener('click', () => selectCatalog(btn.dataset.catalog || ''));
  });
}

function fillBadgeFilter() {
  const select = $('badgeFilter');
  if (!select) return;
  const current = select.value;
  const labels = getCustomLabels();
  select.innerHTML = `<option value="">Todas</option>` +
    labels.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.label)}</option>`).join('');
  if (current && labels.some(l => l.id === current)) select.value = current;
}
function cartLineKey(item) {
  return [item.code, item.size, item.colorCode, item.colorName || ''].join('||');
}
function normalizeCodeKey(code) {
  return String(code || '').trim().toUpperCase().replace(/^0+/, '').replace(/[^A-Z0-9]/g, '');
}
function findProductByCode(code) {
  const key = normalizeCodeKey(code);
  if (!key) return null;
  const exact = products.find(p => normalizeCodeKey(p.code) === key);
  if (exact) return exact;
  return products.find(p => normalizeCodeKey(p.code).endsWith(key) || key.endsWith(normalizeCodeKey(p.code))) || null;
}
function matchOrderColor(product, colorName) {
  const raw = String(colorName || '').trim();
  const n = normalizeText(raw);
  if (!n || n === 'surtido' || n === 'todos') {
    return { code: SURTIDO_COLOR, name: 'Surtido', image: '' };
  }
  const translated = normalizeText(translateText(raw));
  const colors = product?.colors || [];
  const hit = colors.find(c => {
    const name = normalizeText(c.name);
    const code = normalizeText(c.code);
    const tname = normalizeText(translateText(c.name || ''));
    return name === n || tname === n || name === translated || tname === translated || code === n;
  }) || colors.find(c => {
    const name = normalizeText(c.name);
    const tname = normalizeText(translateText(c.name || ''));
    return name.includes(n) || n.includes(name) || tname.includes(translated) || translated.includes(tname);
  });
  if (hit) {
    return {
      code: hit.code,
      name: translateText(hit.name) || hit.name || hit.code,
      image: hit.image || ''
    };
  }
  return { code: raw.slice(0, 40), name: translateText(raw) || raw, image: '' };
}
function matchOrderSize(size) {
  const raw = String(size || '').trim();
  const n = normalizeText(raw);
  if (!n || n === 'todos' || n === 'surtido') return SURTIDO_SIZE;
  return raw;
}
function parseOrderCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const parts = line.includes(';') ? line.split(';') : line.split(',');
    const cleaned = parts.map(p => p.trim().replace(/^"|"$/g, ''));
    // support leading empty column from Numbers export
    const start = cleaned[0] === '' ? 1 : 0;
    const code = cleaned[start] || '';
    const name = cleaned[start + 1] || '';
    const color = cleaned[start + 2] || '';
    const size = cleaned[start + 3] || '';
    const qty = parseInt(cleaned[start + 4], 10);
    if (!code || /^(codigo|código)$/i.test(code) || /^total$/i.test(code)) continue;
    if (!Number.isFinite(qty) || qty < 1) continue;
    rows.push({ code, name, color, size, qty });
  }
  return rows;
}
function findProductByName(name) {
  const n = normalizeText(translateText(name || ''));
  if (!n || n.length < 8) return null;
  let best = null;
  let bestScore = 0;
  for (const p of products) {
    const pn = normalizeText(translateText(p.name || ''));
    if (!pn) continue;
    if (pn === n) return p;
    if (pn.includes(n) || n.includes(pn)) {
      const score = Math.min(pn.length, n.length);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return bestScore >= 12 ? best : null;
}
function importOrderRows(rows, { notes, replace = true } = {}) {
  if (!rows.length) throw new Error('No se encontraron líneas válidas en el archivo.');
  const incoming = [];
  let matched = 0;
  let unmatched = 0;
  for (const row of rows) {
    const product = findProductByCode(row.code) || findProductByName(row.name);
    const color = matchOrderColor(product, row.color);
    const size = matchOrderSize(row.size);
    if (product) matched += 1;
    else unmatched += 1;
    incoming.push({
      productId: product?.id || '',
      code: product?.code || row.code,
      name: translateText(product?.name || row.name || row.code),
      size,
      colorCode: color.code,
      colorName: color.name,
      image: color.image || product?.image || '',
      priceArs: null,
      fobUsd: Number.isFinite(product?.fobUsd) ? product.fobUsd : null,
      qty: row.qty
    });
  }
  if (replace) cart = [];
  for (const line of incoming) {
    const key = cartLineKey(line);
    const existing = cart.find(item => cartLineKey(item) === key);
    if (existing) {
      existing.qty += line.qty;
      if (existing.fobUsd == null && line.fobUsd != null) existing.fobUsd = line.fobUsd;
      if (!existing.productId && line.productId) existing.productId = line.productId;
    } else {
      cart.push(line);
    }
  }
  if (notes) cartNotes = String(notes).slice(0, 800);
  saveCart();
  if ($('cartNotes')) $('cartNotes').value = cartNotes;
  updateCartBadge();
  updateOrderDock();
  renderCart();
  return { matched, unmatched, lines: incoming.length, units: cartTotalQty() };
}
function showImportMsg(text, ok = true) {
  const msg = $('importOrderMsg');
  if (!msg) return;
  msg.hidden = false;
  msg.textContent = text;
  msg.classList.toggle('ok', ok);
  msg.classList.toggle('err', !ok);
}
async function importOrderFromFile(file) {
  const text = await file.text();
  const rows = parseOrderCsv(text);
  const result = importOrderRows(rows, {
    notes: cartNotes || `Importado: ${file.name}`,
    replace: !cart.length
  });
  showImportMsg(`Importado: ${result.lines} líneas · ${result.matched} con catálogo${result.unmatched ? ` · ${result.unmatched} sin match` : ''}. Ya podés sumar más productos.`);
  openCart();
}
function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(cartStorageKey()) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && item.code && item.qty > 0);
  } catch {
    return [];
  }
}
function loadNotes() {
  try {
    return String(localStorage.getItem(notesStorageKey()) || '').slice(0, 800);
  } catch {
    return '';
  }
}
function saveCart() {
  localStorage.setItem(cartStorageKey(), JSON.stringify(cart));
  localStorage.setItem(notesStorageKey(), cartNotes);
  updateCartBadge();
  updateOrderDock();
}
function cartTotalQty() {
  return cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
}
function cartTotalMoney() {
  return cart.reduce((sum, item) => {
    const price = brasilMode ? item.fobUsd : item.priceArs;
    if (!Number.isFinite(price)) return sum;
    return sum + price * Number(item.qty || 0);
  }, 0);
}
function formatCatalogPrice(p) {
  if (brasilMode) {
    return Number.isFinite(p.fobUsd) ? formatFob(p.fobUsd) : 'Consultar';
  }
  return formatArs(p.priceArs);
}
function formatLinePrice(item) {
  if (brasilMode) {
    return Number.isFinite(item.fobUsd) ? formatFob(item.fobUsd) : 'Consultar';
  }
  return formatArs(item.priceArs);
}
function hasCatalogPrice(p) {
  return brasilMode ? Number.isFinite(p.fobUsd) : Number.isFinite(p.priceArs);
}
function updateCartBadge() {
  const count = cartTotalQty();
  const badge = $('cartCount');
  if (!badge) return;
  badge.textContent = String(count);
  badge.hidden = count === 0;
}
function updateOrderDock() {
  const dock = $('orderDock');
  if (!dock) return;
  const total = cartTotalQty();
  dock.hidden = total === 0;
  const money = cartTotalMoney();
  $('dockSummary').textContent = total
    ? `${total} unidad${total === 1 ? '' : 'es'} · ${brasilMode ? formatFob(money) : formatArs(money)}`
    : 'Pedido vacío';
}
function applyTextScale(scale) {
  const next = TEXT_SCALES.includes(scale) ? scale : 'md';
  document.documentElement.dataset.text = next;
  try { localStorage.setItem(textScaleKey(), next); } catch {}
}
function bumpTextScale(delta) {
  const current = document.documentElement.dataset.text || localStorage.getItem(textScaleKey()) || 'md';
  const idx = Math.max(0, Math.min(TEXT_SCALES.length - 1, TEXT_SCALES.indexOf(current) + delta));
  applyTextScale(TEXT_SCALES[idx]);
}
function showCartMsg(text, ok = true) {
  const msg = $('cartFormMsg');
  if (!msg) return;
  msg.hidden = false;
  msg.textContent = text;
  msg.classList.toggle('ok', ok);
  msg.classList.toggle('err', !ok);
  clearTimeout(cartMsgTimer);
  cartMsgTimer = setTimeout(() => { msg.hidden = true; }, 1800);
}

async function init() {
  const me = await api('/api/me');
  currentUser = me.user;
  whatsappNumber = me.whatsappNumber || '';
  $('userName').textContent = currentUser.name || currentUser.username;

  const admin = isAdmin();
  if ($('adminLink')) $('adminLink').hidden = !admin;
  if ($('brasilLink')) $('brasilLink').hidden = true;
  if ($('mayoristaLink')) $('mayoristaLink').hidden = true;

  if (brasilMode) {
    if (!admin) {
      window.location.href = '/';
      return;
    }
    document.title = 'Pedidos Brasil | Lupo';
    if ($('topbarMode')) $('topbarMode').textContent = 'Pedidos Brasil';
    if ($('catalogBlurb')) $('catalogBlurb').textContent = 'Todos los productos del sistema. Precios en FOB USD para pedidos a Brasil.';
    if ($('userList')) $('userList').textContent = 'Pedido Brasil · FOB USD';
    if ($('mayoristaLink')) $('mayoristaLink').hidden = false;
    if ($('logoHome')) $('logoHome').href = '/brasil';
    document.body.classList.add('brasil-mode');
    if ($('brasilImport')) $('brasilImport').hidden = false;
    if ($('cartTitle')) $('cartTitle').textContent = 'Pedido Brasil';
    if ($('viewPedidoPageBtn')) $('viewPedidoPageBtn').hidden = false;
    if ($('dockPedidoPageBtn')) $('dockPedidoPageBtn').hidden = false;
  } else {
    $('userList').textContent = me.priceListName ? `Lista ${me.priceListName}` : 'Sin lista asignada';
    if (admin && $('brasilLink')) $('brasilLink').hidden = false;
  }

  const catalog = brasilMode
    ? await api('/api/admin/catalog-brasil')
    : await api('/api/catalog');
  products = catalog.products || [];
  setCustomLabels(catalog.labels || []);
  cart = loadCart();
  cartNotes = loadNotes();
  if ($('cartNotes')) $('cartNotes').value = cartNotes;
  applyTextScale(localStorage.getItem(textScaleKey()) || 'md');
  updateCartBadge();
  updateOrderDock();
  buildCatalogNav(catalog.catalogs || []);
  fillBadgeFilter();

  opt($('catalogFilter'), unique(products.map(p => p.catalog)).sort((a, b) => {
    const al = LINGERIE_CATALOGS.has(a) ? 0 : 1;
    const bl = LINGERIE_CATALOGS.has(b) ? 0 : 1;
    return al !== bl ? al - bl : catalogLabel(a).localeCompare(catalogLabel(b), 'es');
  }), 'Todos', catalogLabel);
  opt($('categoryFilter'), unique(products.map(p => p.category)), 'Todas');
  opt($('sizeFilter'), unique(products.map(p => p.sizes).flatMap(sizesFrom)), 'Todos', v => v);
  opt($('colorFilter'), unique(products.flatMap(p => (p.colors || []).map(colorLabel))), 'Todos', v => v);

  $('headerSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    syncState();
    render();
  });
  ['search', 'codes', 'catalogFilter', 'categoryFilter', 'sizeFilter', 'colorFilter', 'badgeFilter'].forEach(id => {
    $(id).addEventListener('input', () => {
      if (id === 'catalogFilter') state.promos = false;
      syncState();
      if (id === 'catalogFilter') setActiveCatalog(state.catalog);
      render();
    });
  });
  $('offerCards').addEventListener('click', e => {
    const btn = e.target.closest('[data-offer]');
    if (!btn) return;
    const next = state.badge === btn.dataset.offer ? '' : btn.dataset.offer;
    $('badgeFilter').value = next;
    syncState();
    render();
  });
  $('clearBtn').addEventListener('click', resetFilters);
  $('copyBtn').addEventListener('click', copyVisibleCodes);
  $('gridBtn').addEventListener('click', () => setView('grid'));
  $('listBtn').addEventListener('click', () => setView('list'));
  $('closeModal').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('addToCartForm').addEventListener('submit', onAddToCart);
  $('cartSizeChips').addEventListener('click', e => onChipClick(e, 'size'));
  $('cartColorChips').addEventListener('click', e => onChipClick(e, 'color'));
  $('modalChangePhotoBtn')?.addEventListener('click', () => $('modalPhotoFile')?.click());
  $('modalPhotoFile')?.addEventListener('change', async () => {
    const file = $('modalPhotoFile').files[0];
    $('modalPhotoFile').value = '';
    if (!file) return;
    try {
      await uploadModalPhoto(file);
    } catch (err) {
      showCartMsg(err.message || 'No se pudo actualizar la foto.', false);
    }
  });
  $('modalRestorePhotoBtn')?.addEventListener('click', async () => {
    try {
      await restoreModalPhoto();
    } catch (err) {
      showCartMsg(err.message || 'No se pudo restaurar la foto.', false);
    }
  });
  $('addToCartForm').addEventListener('click', e => {
    const step = e.target.closest('[data-qty-step]');
    if (!step) return;
    const input = $('cartQty');
    const maxAttr = input.getAttribute('max');
    const max = maxAttr != null && maxAttr !== '' ? Number(maxAttr) : null;
    let next = Math.max(1, (parseInt(input.value, 10) || 1) + Number(step.dataset.qtyStep));
    if (Number.isFinite(max) && max >= 0) next = Math.min(next, Math.max(0, max) || 1);
    if (Number.isFinite(max) && max <= 0) next = 1;
    input.value = String(next);
  });
  $('cartBtn').addEventListener('click', openCart);
  $('dockCartBtn')?.addEventListener('click', openCart);
  $('dockSendBtn')?.addEventListener('click', sendOrderWhatsapp);
  $('closeCart').addEventListener('click', closeCart);
  $('cartDrawer').addEventListener('click', e => {
    if (e.target.matches('[data-close-cart]')) closeCart();
  });
  $('clearCartBtn').addEventListener('click', clearCart);
  $('downloadExcelBtn')?.addEventListener('click', downloadOrderExcel);
  $('sendWhatsappBtn').addEventListener('click', sendOrderWhatsapp);
  $('cartNotes').addEventListener('input', () => {
    cartNotes = $('cartNotes').value.slice(0, 800);
    saveCart();
  });
  $('importOrderFile')?.addEventListener('change', async () => {
    const file = $('importOrderFile').files?.[0];
    $('importOrderFile').value = '';
    if (!file) return;
    try {
      await importOrderFromFile(file);
    } catch (err) {
      showImportMsg(err.message || 'No se pudo importar el CSV.', false);
    }
  });
  $('textBigger').addEventListener('click', () => bumpTextScale(1));
  $('textSmaller').addEventListener('click', () => bumpTextScale(-1));
  $('cartItems').addEventListener('click', onCartItemsClick);
  $('cartItems').addEventListener('change', onCartItemsChange);
  $('logoutBtn').addEventListener('click', logout);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('cartDrawer').classList.contains('open')) closeCart();
    else closeModal();
  });
  render();
}

function syncState() {
  state.search = $('search').value;
  state.codes = $('codes').value;
  state.catalog = $('catalogFilter').value;
  state.category = $('categoryFilter').value;
  state.size = $('sizeFilter').value;
  state.color = $('colorFilter').value;
  state.badge = $('badgeFilter') ? $('badgeFilter').value : '';
  if (state.catalog) state.promos = false;
}
function resetFilters() {
  state.promos = false;
  ['search', 'codes', 'catalogFilter', 'categoryFilter', 'sizeFilter', 'colorFilter', 'badgeFilter'].forEach(id => { if ($(id)) $(id).value = ''; });
  setActiveCatalog('');
  syncState();
  render();
}
function setView(view) {
  state.view = view;
  document.body.classList.toggle('list', view === 'list');
  $('gridBtn').classList.toggle('btn-black', view === 'grid');
  $('gridBtn').classList.toggle('btn-ghost', view !== 'grid');
  $('listBtn').classList.toggle('btn-black', view === 'list');
  $('listBtn').classList.toggle('btn-ghost', view !== 'list');
}
function filtered() {
  const q = normalizeText(state.search);
  const wantedCodes = getCodes(state.codes);
  const wantedColor = normalizeText(state.color);
  return products.filter(p => {
    const translatedBlob = translateText([p.code, p.name, p.category, p.catalog, p.sizes, p.description, ...(p.tech || []), (p.colors || []).map(c => `${c.code} ${c.name}`).join(' ')].join(' '));
    const blob = normalizeText([translatedBlob, p.code, p.name, p.category, p.catalog, p.sizes, p.description, ...(p.tech || []), (p.colors || []).map(c => `${c.code} ${c.name}`).join(' ')].join(' '));
    if (q && !blob.includes(q)) return false;
    if (wantedCodes.length && !wantedCodes.some(c => normalizeText(p.code).includes(c))) return false;
    if (state.promos) {
      if (!p.badge || !isPromoLabel(p.badge)) return false;
    } else if (state.catalog && p.catalog !== state.catalog) return false;
    if (state.category && p.category !== state.category) return false;
    if (state.size && !normalizeText(p.sizes).includes(normalizeText(state.size))) return false;
    if (state.color && !(p.colors || []).some(c => normalizeText(colorLabel(c)).includes(wantedColor))) return false;
    if (state.badge && p.badge !== state.badge) return false;
    return true;
  }).sort((a, b) => {
    const al = LINGERIE_CATALOGS.has(a.catalog) ? 0 : 1;
    const bl = LINGERIE_CATALOGS.has(b.catalog) ? 0 : 1;
    if (al !== bl) return al - bl;
    const ao = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.POSITIVE_INFINITY;
    const bo = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    const aw = a.badge ? 0 : 1;
    const bw = b.badge ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return a.code.localeCompare(b.code, undefined, { numeric: true });
  });
}
function offerTagHtml(p) {
  if (!p.badge) return '';
  const style = badgeStyle(p.badge);
  const text = badgeLabel(p.badge, p.badgeText);
  if (!text) return '';
  return `<span class="offer-tag" style="${escapeHtml(style)}">${escapeHtml(text)}</span>`;
}

function renderOfferCards() {
  const wrap = $('offerCards');
  if (!wrap) return;
  const counts = {};
  products.forEach(p => {
    if (p.badge) counts[p.badge] = (counts[p.badge] || 0) + 1;
  });
  const cards = getCustomLabels().filter(l => counts[l.id] > 0);
  wrap.hidden = !cards.length;
  wrap.innerHTML = cards.map(b => `
    <button type="button" class="offer-card ${state.badge === b.id ? 'active' : ''}" data-offer="${escapeHtml(b.id)}" style="border-left:4px solid ${escapeHtml(b.color)}">
      <b>${escapeHtml(b.label)}</b>
      <span>${counts[b.id]} ${counts[b.id] === 1 ? 'artículo' : 'artículos'}</span>
    </button>
  `).join('');
}
function render() {
  renderOfferCards();
  const data = filtered();
  $('resultCount').textContent = data.length;
  $('empty').style.display = data.length ? 'none' : 'block';
  const grid = $('grid');
  grid.innerHTML = data.map(card).join('');
  grid.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => openModal(btn.dataset.open)));
}
function card(p) {
  const priced = hasCatalogPrice(p);
  const title = productDisplayName(p);
  return `<article class="product">
    <div class="thumb"><img loading="lazy" src="${productImage(p)}" alt="${escapeHtml(title)}"><span class="badge">${escapeHtml(p.code)}</span>${offerTagHtml(p)}</div>
    <div class="info">
      <h4>${escapeHtml(title)}</h4>
      <div class="price ${priced ? '' : 'muted'}">${escapeHtml(formatCatalogPrice(p))}</div>
      <div class="meta"><span class="pill">${escapeHtml(catalogLabel(p.catalog))}</span><span class="pill">${escapeHtml(translateText(p.category))}</span></div>
      <p class="desc">${escapeHtml(translateText(p.description || 'Sin descripción cargada.'))}</p>
      <div class="card-actions">
        <button class="btn btn-black" data-open="${p.id}">Pedir</button>
      </div>
    </div>
  </article>`;
}

function fillCartForm(p) {
  $('cartProductId').value = p.id;
  const sizes = sizesFrom(p.sizes);
  const colors = (p.colors && p.colors.length) ? p.colors : [{ code: '-', name: 'Sin color' }];
  const nameCounts = colors.reduce((acc, c) => {
    const key = normalizeText(colorLabel(c));
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  $('cartSizeChips').innerHTML = [
    ...sizes.map(s => `<button type="button" class="choice-chip" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`),
    `<button type="button" class="choice-chip" data-size="${escapeHtml(SURTIDO_SIZE)}">${escapeHtml(SURTIDO_SIZE)}</button>`
  ].join('');
  $('cartColorChips').innerHTML = [
    ...colors.map(c => {
      const base = colorLabel(c);
      const dup = nameCounts[normalizeText(base)] > 1;
      const label = escapeHtml(dup ? `${base} · ${c.code}` : base);
      const src = colorPhoto(c) || '';
      return `<button type="button" class="choice-chip" data-color="${escapeHtml(c.code)}" data-name="${escapeHtml(translateText(c.name))}" data-image="${escapeHtml(src)}">${label}</button>`;
    }),
    `<button type="button" class="choice-chip" data-color="${escapeHtml(SURTIDO_COLOR)}" data-name="Surtido" data-image="">Surtido</button>`
  ].join('');
  $('cartQty').value = 1;
  $('cartQty').removeAttribute('max');
  $('cartFormMsg').hidden = true;
  if (sizes.length === 1) selectSize(sizes[0]);
  else selectSize('');
  if (colors.length === 1) selectColor(colors[0].code, translateText(colors[0].name));
  else selectColor('', '');
  syncStockHint();
}

function selectedVariantStock() {
  const p = modalProduct;
  if (!p || brasilMode) return null;
  const size = $('cartSize')?.value || '';
  const colorCode = $('cartColor')?.value || '';
  if (!size || !colorCode || size === SURTIDO_SIZE || colorCode === SURTIDO_COLOR) return null;
  return stockQty(p.stock, size, colorCode);
}

function syncStockHint() {
  const hint = $('cartStockHint');
  const addBtn = document.querySelector('#addToCartForm button[type="submit"]');
  if (!hint) return;
  const available = selectedVariantStock();
  if (available == null) {
    hint.hidden = true;
    hint.textContent = '';
    hint.className = 'stock-hint';
    $('cartQty')?.removeAttribute('max');
    if (addBtn) addBtn.disabled = false;
    return;
  }
  hint.hidden = false;
  if (available <= 0) {
    hint.textContent = 'Sin stock para este talle y color';
    hint.className = 'stock-hint warn';
    $('cartQty').value = 1;
    $('cartQty').setAttribute('max', '0');
    if (addBtn) addBtn.disabled = true;
    return;
  }
  hint.textContent = `Stock disponible: ${available}`;
  hint.className = 'stock-hint ok';
  $('cartQty').setAttribute('max', String(available));
  const qty = Math.max(1, parseInt($('cartQty').value, 10) || 1);
  if (qty > available) $('cartQty').value = available;
  if (addBtn) addBtn.disabled = false;
}

function selectSize(value) {
  $('cartSize').value = value || '';
  $('cartSizeChips').querySelectorAll('.choice-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === value);
  });
  syncStockHint();
}
function selectColor(code, name) {
  $('cartColor').value = code || '';
  $('cartColor').dataset.name = name || '';
  $('cartColorChips').querySelectorAll('.choice-chip').forEach(btn => {
    const same = btn.dataset.color === code && (btn.dataset.name === name || !name);
    btn.classList.toggle('active', Boolean(code) && same);
  });
  if (modalProduct && $('modalImage')) {
    if (code === SURTIDO_COLOR || !code) {
      $('modalImage').src = productImage(modalProduct);
    } else {
      const fromProduct = (modalProduct.colors || []).find(c => String(c.code) === String(code));
      const chip = [...$('cartColorChips').querySelectorAll('.choice-chip')].find(btn => btn.classList.contains('active'));
      const src = colorPhoto(fromProduct) || (chip && chip.dataset.image) || productImage(modalProduct);
      $('modalImage').src = src;
    }
  }
  syncModalPhotoEdit();
  syncStockHint();
}
function onChipClick(e, kind) {
  const btn = e.target.closest('.choice-chip');
  if (!btn) return;
  if (kind === 'size') selectSize(btn.dataset.size);
  else selectColor(btn.dataset.color, btn.dataset.name);
}

function openModal(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  modalProduct = p;
  $('modalImage').src = productImage(p);
  const offer = $('modalOffer');
  const text = badgeLabel(p.badge, p.badgeText);
  if (offer) {
    offer.hidden = !text;
    offer.className = 'offer-tag';
    offer.style.cssText = badgeStyle(p.badge);
    offer.textContent = text;
  }
  $('modalTitle').textContent = productDisplayName(p);
  $('modalCode').textContent = p.code;
  $('modalPrice').textContent = formatCatalogPrice(p);
  $('modalPrice').classList.toggle('muted', !hasCatalogPrice(p));
  $('modalDesc').textContent = translateText(p.description || '');
  fillCartForm(p);
  const colorNames = productColorNames(p);
  const priceRowLabel = brasilMode ? 'FOB USD' : 'Precio';
  $('modalMeta').innerHTML = `
    <tr><td>${priceRowLabel}</td><td>${escapeHtml(formatCatalogPrice(p))}</td></tr>
    <tr><td>Catálogo</td><td>${escapeHtml(catalogLabel(p.catalog))}</td></tr>
    <tr><td>Categoría</td><td>${escapeHtml(translateText(p.category))}</td></tr>
    <tr><td>Talles</td><td>${escapeHtml(p.sizes || 'No detectado')}</td></tr>
    <tr><td>Colores</td><td>${colorNames.map(n => escapeHtml(n)).join(' · ') || 'No detectado'}</td></tr>
    <tr><td>Tecnología</td><td>${(p.tech || []).map(t => escapeHtml(translateText(t))).join(' · ') || 'No detectado'}</td></tr>
    <tr><td>Origen</td><td>${p.pdf ? `<a href="${p.pdf.startsWith('http') ? p.pdf : `${p.pdf}#page=${p.page}`}" target="_blank">Ver catálogo${p.page ? `, página ${p.page}` : ''}</a>` : '—'}</td></tr>`;
  syncModalPhotoEdit();
  $('modal').classList.add('open');
}
function closeModal() {
  $('modal').classList.remove('open');
  modalProduct = null;
}

function onAddToCart(e) {
  e.preventDefault();
  const p = products.find(x => x.id === $('cartProductId').value);
  if (!p) {
    showCartMsg('No se encontró el producto.', false);
    return;
  }
  const size = $('cartSize').value;
  const colorCode = $('cartColor').value;
  const colorName = $('cartColor').dataset.name || '';
  let qty = Math.max(1, parseInt($('cartQty').value, 10) || 1);
  if (!size || !colorCode) {
    showCartMsg('Elegí talle y color para continuar.', false);
    return;
  }
  const available = (!brasilMode && size !== SURTIDO_SIZE && colorCode !== SURTIDO_COLOR)
    ? stockQty(p.stock, size, colorCode)
    : null;
  let capped = false;
  if (available != null) {
    if (available <= 0) {
      showCartMsg('Sin stock para este talle y color.', false);
      return;
    }
    const existingKey = cartLineKey({ code: p.code, size, colorCode, colorName });
    const existingQty = cart.find(item => cartLineKey(item) === existingKey)?.qty || 0;
    if (existingQty + qty > available) {
      const room = available - existingQty;
      if (room <= 0) {
        showCartMsg(`Ya tenés el máximo disponible (${available}).`, false);
        return;
      }
      qty = room;
      capped = true;
    }
  }
  const incoming = {
    productId: p.id,
    code: p.code,
    name: translateText(p.name),
    size,
    colorCode,
    colorName,
    image: (() => {
      if (colorCode === SURTIDO_COLOR || !colorCode || colorCode === '-') return p.image || '';
      const color = (p.colors || []).find(c => String(c.code) === String(colorCode));
      return color?.image || p.image || '';
    })(),
    priceArs: Number.isFinite(p.priceArs) ? p.priceArs : null,
    fobUsd: Number.isFinite(p.fobUsd) ? p.fobUsd : null,
    qty
  };
  const key = cartLineKey(incoming);
  const existing = cart.find(item => cartLineKey(item) === key);
  if (existing) {
    existing.qty += qty;
    if (existing.priceArs == null && incoming.priceArs != null) existing.priceArs = incoming.priceArs;
    if (existing.fobUsd == null && incoming.fobUsd != null) existing.fobUsd = incoming.fobUsd;
  } else {
    cart.push(incoming);
  }
  saveCart();
  showCartMsg(capped ? `Se agregaron ${qty} u. (máximo disponible).` : `Agregado: ${qty} u.`);
  $('cartQty').value = 1;
  syncStockHint();
}

function openCart() {
  renderCart();
  $('cartDrawer').classList.add('open');
  $('cartDrawer').setAttribute('aria-hidden', 'false');
}
function closeCart() {
  $('cartDrawer').classList.remove('open');
  $('cartDrawer').setAttribute('aria-hidden', 'true');
}
function renderCart() {
  const total = cartTotalQty();
  const money = cartTotalMoney();
  $('cartSummary').textContent = total
    ? `${cart.length} línea${cart.length === 1 ? '' : 's'} · ${total} unidad${total === 1 ? '' : 'es'} · ${brasilMode ? formatFob(money) : formatArs(money)}`
    : 'Sin artículos';
  $('clearCartBtn').disabled = !cart.length;
  if ($('sendWhatsappBtn')) $('sendWhatsappBtn').disabled = !cart.length;
  if ($('downloadExcelBtn')) $('downloadExcelBtn').disabled = !cart.length;
  if ($('cartNotes') && $('cartNotes').value !== cartNotes) $('cartNotes').value = cartNotes;
  if (!cart.length) {
    $('cartItems').innerHTML = `<div class="cart-empty"><p>Todavía no agregaste productos.</p><p>Abrí un producto, elegí talle, color y cantidad, y sumalo al pedido.</p></div>`;
    return;
  }
  $('cartItems').innerHTML = cart.map((item, index) => `
    <article class="cart-line" data-index="${index}">
      <div class="cart-line-main">
        <strong class="cart-line-code">${escapeHtml(item.code)}</strong>
        <span class="cart-line-name">${escapeHtml(item.name || '')}</span>
        <div class="cart-line-meta">
          <span>Talle: <b>${escapeHtml(item.size)}</b></span>
          <span>Color: <b>${escapeHtml(item.colorName || item.colorCode)}</b></span>
          <span>${brasilMode ? 'FOB' : 'Precio'}: <b>${escapeHtml(formatLinePrice(item))}</b></span>
        </div>
      </div>
      <div class="cart-line-actions">
        <label class="cart-qty-label">
          Cant.
          <input type="number" min="1" step="1" value="${item.qty}" data-qty="${index}">
        </label>
        <button type="button" class="btn btn-ghost" data-remove="${index}">Quitar</button>
      </div>
    </article>
  `).join('');
}
function onCartItemsClick(e) {
  const removeBtn = e.target.closest('[data-remove]');
  if (!removeBtn) return;
  const index = Number(removeBtn.dataset.remove);
  if (!Number.isInteger(index)) return;
  cart.splice(index, 1);
  saveCart();
  renderCart();
}
function onCartItemsChange(e) {
  const input = e.target.closest('[data-qty]');
  if (!input) return;
  const index = Number(input.dataset.qty);
  if (!Number.isInteger(index) || !cart[index]) return;
  const qty = Math.max(1, parseInt(input.value, 10) || 1);
  cart[index].qty = qty;
  input.value = qty;
  saveCart();
  renderCart();
}
function clearCart() {
  if (!cart.length) return;
  if (!confirm('¿Vaciar todo el pedido?')) return;
  cart = [];
  saveCart();
  renderCart();
}

function downloadExcelFile(xml, filename) {
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `pedido-lupo.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadOrderExcel() {
  if (!cart.length) {
    alert('El pedido está vacío.');
    return;
  }
  const btn = $('downloadExcelBtn');
  if (btn) btn.disabled = true;
  try {
    const endpoint = brasilMode ? '/api/admin/orders-brasil/export' : '/api/orders/export';
    const data = await api(endpoint, {
      method: 'POST',
      body: { items: cart, notes: cartNotes }
    });
    if (data.xml) downloadExcelFile(data.xml, data.filename);
  } catch (err) {
    alert(err.message || 'No se pudo descargar el Excel.');
  } finally {
    if (btn) btn.disabled = !cart.length;
  }
}

async function sendOrderWhatsapp() {
  if (!cart.length) {
    alert('El pedido está vacío.');
    return;
  }
  const btn = $('sendWhatsappBtn');
  const dockBtn = $('dockSendBtn');
  if (btn) btn.disabled = true;
  if (dockBtn) dockBtn.disabled = true;
  try {
    const endpoint = brasilMode ? '/api/admin/orders-brasil' : '/api/orders';
    const data = await api(endpoint, {
      method: 'POST',
      body: { items: cart, notes: cartNotes }
    });
    if (data.whatsappUrl) {
      window.open(data.whatsappUrl, '_blank', 'noopener');
      return;
    }
    const file = new File([data.xml], data.filename || (brasilMode ? 'pedido-brasil.xls' : 'pedido-lupo.xls'), { type: 'application/vnd.ms-excel' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: brasilMode ? 'Pedido Brasil Lupo' : 'Pedido Lupo', text: data.message });
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
    if (data.xml) downloadExcelFile(data.xml, data.filename);
    const text = encodeURIComponent(data.message || (brasilMode ? 'Pedido Brasil Lupo' : 'Pedido Lupo'));
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
    alert('Configurá tu número de WhatsApp en Administración para que el pedido te llegue directo.');
  } catch (err) {
    alert(err.message || 'No se pudo enviar el pedido.');
  } finally {
    if (btn) btn.disabled = !cart.length;
    if (dockBtn) dockBtn.disabled = !cart.length;
  }
}

async function copyVisibleCodes() {
  const codes = unique(filtered().map(p => p.code)).join('\n');
  try {
    await navigator.clipboard.writeText(codes);
    $('copyBtn').textContent = 'Copiado';
    setTimeout(() => $('copyBtn').textContent = 'Copiar códigos visibles', 1200);
  } catch {
    alert(codes);
  }
}

init().catch(err => {
  if (err.message !== 'No autenticado') {
    console.error(err);
    alert(err.message || 'No se pudo cargar el catálogo');
  }
});
