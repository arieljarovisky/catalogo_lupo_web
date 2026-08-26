const { escapeHtml, translateText, normalizeText, formatArs, api, logout, catalogLabel, PRODUCT_BADGES, badgeInfo, badgeLabel } = window.LupoCommon;

const state = { search: '', codes: '', catalog: '', category: '', size: '', color: '', badge: '', view: 'grid' };
const $ = id => document.getElementById(id);
const SURTIDO_SIZE = 'Surtido';
const SURTIDO_COLOR = 'SURTIDO';
const SURTIDO_COLOR_NAME = 'Colores surtido';
const TEXT_SCALES = ['md', 'lg', 'xl'];
let products = [];
let currentUser = null;
let cart = [];
let cartNotes = '';
let cartMsgTimer = null;
let whatsappNumber = '';
let modalProduct = null;

function cartStorageKey() {
  return `lupo-cart-v2-${currentUser?.username || 'anon'}`;
}
function notesStorageKey() {
  return `lupo-cart-notes-v1-${currentUser?.username || 'anon'}`;
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
function sizesFrom(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return ['Único'];
  let parts = raw.split(/\s*[•·|]\s*/).map(x => x.trim()).filter(Boolean);
  if (parts.length === 1 && /[\/,]/.test(parts[0]) && !/\d/.test(parts[0])) {
    parts = parts[0].split(/[\/,]/).map(x => x.trim()).filter(Boolean);
  }
  return parts.length ? parts : ['Único'];
}
function colorLabel(c) {
  const name = translateText(c.name || '').trim();
  if (name) return name;
  const code = String(c.code || '').trim();
  return !code || code === '-' ? 'Sin color' : code;
}
function productImage(p) {
  return assetUrl(p && p.image);
}
function assetUrl(src) {
  const value = String(src || '');
  if (!value || value.startsWith('http') || value.includes('?')) return value;
  return `${value}?v=4`;
}
function colorPhoto(c) {
  return assetUrl(c && c.image);
}
function selectCatalog(catalogName) {
  $('catalogFilter').value = catalogName || '';
  setActiveCatalog(catalogName || '');
  syncState();
  render();
}
function setActiveCatalog(catalogName) {
  document.querySelectorAll('#mainNav [data-catalog]').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.catalog || '') === (catalogName || ''));
  });
}
function buildCatalogNav(catalogs) {
  const nav = $('mainNav');
  if (!nav) return;
  nav.innerHTML = `<button type="button" data-catalog="" class="active">Todos</button>` +
    catalogs.map(c => `<button type="button" data-catalog="${escapeHtml(c.catalog)}">${escapeHtml(catalogLabel(c.catalog))}</button>`).join('');
  nav.querySelectorAll('[data-catalog]').forEach(btn => {
    btn.addEventListener('click', () => selectCatalog(btn.dataset.catalog || ''));
  });
}
function cartLineKey(item) {
  return [item.code, item.size, item.colorCode, item.colorName || ''].join('||');
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
function cartTotalArs() {
  return cart.reduce((sum, item) => {
    if (!Number.isFinite(item.priceArs)) return sum;
    return sum + item.priceArs * Number(item.qty || 0);
  }, 0);
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
  const money = cartTotalArs();
  $('dockSummary').textContent = total
    ? `${total} unidad${total === 1 ? '' : 'es'} · ${formatArs(money)}`
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
  $('userList').textContent = me.priceListName ? `Lista ${me.priceListName}` : 'Sin lista asignada';
  if (currentUser.role === 'admin') $('adminLink').hidden = false;

  const catalog = await api('/api/catalog');
  products = catalog.products || [];
  cart = loadCart();
  cartNotes = loadNotes();
  if ($('cartNotes')) $('cartNotes').value = cartNotes;
  applyTextScale(localStorage.getItem(textScaleKey()) || 'md');
  updateCartBadge();
  updateOrderDock();
  buildCatalogNav(catalog.catalogs || []);

  opt($('catalogFilter'), unique(products.map(p => p.catalog)), 'Todos', catalogLabel);
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
  $('addToCartForm').addEventListener('click', e => {
    const step = e.target.closest('[data-qty-step]');
    if (!step) return;
    const input = $('cartQty');
    const next = Math.max(1, (parseInt(input.value, 10) || 1) + Number(step.dataset.qtyStep));
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
  $('sendWhatsappBtn').addEventListener('click', sendOrderWhatsapp);
  $('cartNotes').addEventListener('input', () => {
    cartNotes = $('cartNotes').value.slice(0, 800);
    saveCart();
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
}
function resetFilters() {
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
    if (state.catalog && p.catalog !== state.catalog) return false;
    if (state.category && p.category !== state.category) return false;
    if (state.size && !normalizeText(p.sizes).includes(normalizeText(state.size))) return false;
    if (state.color && !(p.colors || []).some(c => normalizeText(colorLabel(c)).includes(wantedColor))) return false;
    if (state.badge && p.badge !== state.badge) return false;
    return true;
  }).sort((a, b) => {
    const aw = a.badge ? 0 : 1;
    const bw = b.badge ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return a.code.localeCompare(b.code, undefined, { numeric: true });
  });
}
function offerTagHtml(p) {
  const info = badgeInfo(p.badge);
  if (!info) return '';
  return `<span class="offer-tag ${info.className}">${escapeHtml(badgeLabel(p.badge, p.badgeText))}</span>`;
}

function renderOfferCards() {
  const wrap = $('offerCards');
  if (!wrap) return;
  const counts = { promo: 0, last: 0, sale: 0 };
  products.forEach(p => { if (counts[p.badge] != null) counts[p.badge] += 1; });
  const cards = Object.values(PRODUCT_BADGES).filter(b => counts[b.id] > 0);
  wrap.hidden = !cards.length;
  wrap.innerHTML = cards.map(b => `
    <button type="button" class="offer-card ${b.className} ${state.badge === b.id ? 'active' : ''}" data-offer="${b.id}">
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
  grid.querySelectorAll('[data-open-shortcut]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.openShortcut, btn.dataset.shortcut));
  });
}
function card(p) {
  const priced = Number.isFinite(p.priceArs);
  return `<article class="product">
    <div class="thumb"><img loading="lazy" src="${productImage(p)}" alt="${escapeHtml(translateText(p.name))}"><span class="badge">${escapeHtml(p.code)}</span>${offerTagHtml(p)}</div>
    <div class="info">
      <h4>${escapeHtml(translateText(p.name))}</h4>
      <div class="price ${priced ? '' : 'muted'}">${escapeHtml(formatArs(p.priceArs))}</div>
      <div class="meta"><span class="pill">${escapeHtml(catalogLabel(p.catalog))}</span><span class="pill">${escapeHtml(translateText(p.category))}</span></div>
      <p class="desc">${escapeHtml(translateText(p.description || 'Sin descripción cargada.'))}</p>
      <div class="card-actions">
        <button class="btn btn-black" data-open-shortcut="${p.id}" data-shortcut="colors">Pedir</button>
      </div>
    </div>
  </article>`;
}

function fillCartForm(p, shortcut = '') {
  $('cartProductId').value = p.id;
  const sizes = sizesFrom(p.sizes);
  $('cartSizeChips').innerHTML = sizes.map(s =>
    `<button type="button" class="choice-chip" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`
  ).join('');
  $('cartQty').value = 1;
  $('cartFormMsg').hidden = true;
  selectColor(SURTIDO_COLOR, SURTIDO_COLOR_NAME);
  if (shortcut === 'sizes' || shortcut === 'both') {
    selectSize(SURTIDO_SIZE);
  } else if (sizes.length === 1) {
    selectSize(sizes[0]);
  } else {
    selectSize('');
  }
}

function selectSize(value) {
  $('cartSize').value = value || '';
  $('cartSizeChips').querySelectorAll('.choice-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === value);
  });
}
function selectColor(code, name) {
  $('cartColor').value = code || '';
  $('cartColor').dataset.name = name || '';
  if (modalProduct && $('modalImage')) {
    $('modalImage').src = productImage(modalProduct);
  }
}
function onChipClick(e, kind) {
  const btn = e.target.closest('.choice-chip');
  if (!btn) return;
  if (kind === 'size') selectSize(btn.dataset.size);
}

function openModal(id, shortcut = '') {
  const p = products.find(x => x.id === id);
  if (!p) return;
  modalProduct = p;
  $('modalImage').src = productImage(p);
  const offer = $('modalOffer');
  const info = badgeInfo(p.badge);
  if (offer) {
    offer.hidden = !info;
    offer.className = `offer-tag ${info ? info.className : ''}`;
    offer.textContent = info ? badgeLabel(p.badge, p.badgeText) : '';
  }
  $('modalTitle').textContent = translateText(p.name);
  $('modalCode').textContent = p.code;
  $('modalPrice').textContent = formatArs(p.priceArs);
  $('modalPrice').classList.toggle('muted', !Number.isFinite(p.priceArs));
  $('modalDesc').textContent = translateText(p.description || '');
  fillCartForm(p, shortcut);
  $('modalMeta').innerHTML = `
    <tr><td>Precio</td><td>${escapeHtml(formatArs(p.priceArs))}</td></tr>
    <tr><td>Catálogo</td><td>${escapeHtml(catalogLabel(p.catalog))}</td></tr>
    <tr><td>Categoría</td><td>${escapeHtml(translateText(p.category))}</td></tr>
    <tr><td>Talles</td><td>${escapeHtml(p.sizes || 'No detectado')}</td></tr>
    <tr><td>Colores</td><td>${(p.colors || []).map(c => escapeHtml(colorLabel(c))).join('<br>') || 'No detectado'}</td></tr>
    <tr><td>Tecnología</td><td>${(p.tech || []).map(t => escapeHtml(translateText(t))).join(' · ') || 'No detectado'}</td></tr>
    <tr><td>Origen</td><td>${p.pdf ? `<a href="${p.pdf.startsWith('http') ? p.pdf : `${p.pdf}#page=${p.page}`}" target="_blank">Ver catálogo${p.page ? `, página ${p.page}` : ''}</a>` : '—'}</td></tr>`;
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
  const qty = Math.max(1, parseInt($('cartQty').value, 10) || 1);
  if (!size || !colorCode) {
    showCartMsg('Elegí un talle para continuar.', false);
    return;
  }
  const incoming = {
    productId: p.id,
    code: p.code,
    name: translateText(p.name),
    size,
    colorCode,
    colorName,
    priceArs: Number.isFinite(p.priceArs) ? p.priceArs : null,
    qty
  };
  const key = cartLineKey(incoming);
  const existing = cart.find(item => cartLineKey(item) === key);
  if (existing) {
    existing.qty += qty;
    if (existing.priceArs == null && incoming.priceArs != null) existing.priceArs = incoming.priceArs;
  } else {
    cart.push(incoming);
  }
  saveCart();
  showCartMsg(`Agregado: ${qty} u.`);
  $('cartQty').value = 1;
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
  const money = cartTotalArs();
  $('cartSummary').textContent = total
    ? `${cart.length} línea${cart.length === 1 ? '' : 's'} · ${total} unidad${total === 1 ? '' : 'es'} · ${formatArs(money)}`
    : 'Sin artículos';
  $('clearCartBtn').disabled = !cart.length;
  if ($('sendWhatsappBtn')) $('sendWhatsappBtn').disabled = !cart.length;
  if ($('sendWhatsappBtn')) $('sendWhatsappBtn').disabled = !cart.length;
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
          <span>Precio: <b>${escapeHtml(formatArs(item.priceArs))}</b></span>
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
    const data = await api('/api/orders', {
      method: 'POST',
      body: { items: cart, notes: cartNotes }
    });
    if (data.whatsappUrl) {
      window.open(data.whatsappUrl, '_blank', 'noopener');
      return;
    }
    const file = new File([data.xml], data.filename || 'pedido-lupo.xls', { type: 'application/vnd.ms-excel' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Pedido Lupo', text: data.message });
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
    if (data.xml) downloadExcelFile(data.xml, data.filename);
    const text = encodeURIComponent(data.message || 'Pedido Lupo');
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
