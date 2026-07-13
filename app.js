
const CART_STORAGE_KEY = 'lupo-cart-v1';
const state = { search: '', codes: '', catalog: '', category: '', size: '', color: '', view: 'grid' };
const $ = id => document.getElementById(id);
const products = window.PRODUCTS || [];
let cart = loadCart();
let cartMsgTimer = null;

const TRANSLATIONS = [
  ['LANÇAMENTO', 'Novedad'], ['Lançamento', 'Novedad'], ['Lançamentos', 'Novedades'],
  ['Lupo Cuecas', 'Lupo Ropa Interior Masculina'], ['Lupo Meias', 'Lupo Medias'], ['Meia-Calça', 'Pantimedias'], ['Meia-calça', 'Pantimedia'],
  ['FEMININOS', 'FEMENINOS'], ['FEMININO', 'FEMENINO'], ['FEMININA', 'FEMENINA'], ['MASCULINOS', 'MASCULINOS'], ['MASCULINO', 'MASCULINO'],
  ['LINGERIE', 'LENCERÍA'], ['CONFORTO', 'CONFORT'], ['SEM COSTURA', 'SIN COSTURAS'], ['COM COSTURA', 'CON COSTURA'],
  ['TOPS FEMININOS', 'TOPS FEMENINOS'], ['BOT TOMS FEMININO', 'PRENDAS INFERIORES FEMENINAS'], ['BOTTOMS FEMININO', 'PRENDAS INFERIORES FEMENINAS'],
  ['BOXERS SEAMLESS', 'BÓXERS SIN COSTURAS'], ['BOXES SEAMLESS', 'BÓXERS SIN COSTURAS'], ['CUECAS', 'ROPA INTERIOR MASCULINA'], ['CUECA', 'BÓXER'],
  ['MEIAS', 'MEDIAS'], ['MEIA', 'MEDIA'], ['CALÇAS', 'PANTALONES'], ['CALÇA', 'PANTALÓN'], ['CALCA', 'PANTALÓN'], ['SEGUNDA PELE', 'SEGUNDA PIEL'],
  ['LINHA', 'LÍNEA'], ['ATRIBUTOS', 'ATRIBUTOS'], ['TERAPÉUTICA', 'TERAPÉUTICA'], ['ESPORTIVAS', 'DEPORTIVAS'], ['ESPORTIVA', 'DEPORTIVA'],
  ['Algodão', 'Algodón'], ['Preta', 'Negro'], ['Branca', 'Blanco'], ['Cinza', 'Gris'], ['Marinho', 'Azul marino'], ['Vermelho', 'Rojo'], ['Verde Limão', 'Verde limón'],
  ['Tamanhos', 'Tallas'], ['Tamanho', 'Talla'], ['Talles', 'Tallas'], ['Tecnologia', 'Tecnología'], ['Descrição', 'Descripción'],
  ['sem costura', 'sin costuras'], ['com costura', 'con costura'], ['confeccionado', 'confeccionado'], ['confeccionada', 'confeccionada'],
  ['respirabilidade', 'respirabilidad'], ['secagem rápida', 'secado rápido'], ['suor', 'sudor'], ['bactérias', 'bacterias'], ['odores', 'olores'],
  ['frescor', 'frescura'], ['conforto', 'comodidad'], ['durante o uso', 'durante el uso'], ['durante a prática', 'durante la práctica'],
  ['alças', 'breteles'], ['alça', 'bretel'], ['costas', 'espalda'], ['corpo', 'cuerpo'], ['bojo removível', 'copa removible'], ['bojo', 'copa'],
  ['cós', 'cintura'], ['bolso', 'bolsillo'], ['bolsos', 'bolsillos'], ['frontal', 'delantero'], ['traseiro', 'trasero'], ['lateral', 'lateral'],
  ['alto suporte', 'soporte alto'], ['suporte alto', 'soporte alto'], ['suporte médio', 'soporte medio'], ['suporte leve', 'soporte leve'], ['sustenta??o', 'sujeción'],
  ['modelagem', 'modelado'], ['ajuste confortável', 'ajuste cómodo'], ['liberdade de movimento', 'libertad de movimiento'],
  ['ideal para', 'ideal para'], ['atividades', 'actividades'], ['baixo impacto', 'bajo impacto'], ['médio impacto', 'impacto medio'], ['alto impacto', 'alto impacto'],
  ['dia a dia', 'uso diario'], ['toque macio', 'tacto suave'], ['macia', 'suave'], ['opaca', 'opaca'], ['superopaca', 'superopaca'],
  ['Sem demarca??o de ponteira', 'Sin demarcación en la puntera'], ['Com demarca??o de ponteira', 'Con demarcación en la puntera'], ['ponteira', 'puntera'],
  ['Importada', 'Importada'], ['Adulto', 'Adulto'], ['Infantil', 'Infantil']
].sort((a, b) => b[0].length - a[0].length);

function normalizeText(v) {
  return (v || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function getCodes(v) {
  return normalizeText(v).split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
}
function unique(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function escapeHtml(s) {
  return (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function translateText(value) {
  let text = (value || '').toString();
  for (const [from, to] of TRANSLATIONS) {
    text = text.replace(new RegExp(escapeRegExp(from), 'gi'), to);
  }
  return text;
}
function formatFob(value) {
  return Number.isFinite(value) ? `USD ${value.toFixed(2)}` : 'FOB no disponible';
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
  return `${c.code} ${translateText(c.name)}`.trim();
}
function cartLineKey(item) {
  return [item.code, item.size, item.colorCode].join('||');
}
function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && item.code && item.qty > 0).map(item => {
      if (item.fobUsd == null && item.productId) {
        const p = products.find(x => x.id === item.productId);
        if (p && Number.isFinite(p.fobUsd)) item.fobUsd = p.fobUsd;
      }
      return item;
    });
  } catch {
    return [];
  }
}
function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  updateCartBadge();
}
function cartTotalQty() {
  return cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
}
function updateCartBadge() {
  const count = cartTotalQty();
  const badge = $('cartCount');
  if (!badge) return;
  badge.textContent = String(count);
  badge.hidden = count === 0;
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

function init() {
  opt($('catalogFilter'), unique(products.map(p => p.catalog)), 'Todos');
  opt($('categoryFilter'), unique(products.map(p => p.category)), 'Todas');
  opt($('sizeFilter'), unique(products.map(p => p.sizes).flatMap(sizesFrom)), 'Todas', v => v);
  opt($('colorFilter'), unique(products.flatMap(p => p.colors.map(c => `${c.code} ${c.name}`))), 'Todos');

  ['search', 'codes', 'catalogFilter', 'categoryFilter', 'sizeFilter', 'colorFilter'].forEach(id => {
    $(id).addEventListener('input', () => { syncState(); render(); });
  });
  $('clearBtn').addEventListener('click', resetFilters);
  $('copyBtn').addEventListener('click', copyVisibleCodes);
  $('gridBtn').addEventListener('click', () => setView('grid'));
  $('listBtn').addEventListener('click', () => setView('list'));
  $('closeModal').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('addToCartForm').addEventListener('submit', onAddToCart);
  $('cartBtn').addEventListener('click', openCart);
  $('closeCart').addEventListener('click', closeCart);
  $('cartDrawer').addEventListener('click', e => {
    if (e.target.matches('[data-close-cart]')) closeCart();
  });
  $('clearCartBtn').addEventListener('click', clearCart);
  $('exportCartBtn').addEventListener('click', exportCartExcel);
  $('cartItems').addEventListener('click', onCartItemsClick);
  $('cartItems').addEventListener('change', onCartItemsChange);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('cartDrawer').classList.contains('open')) closeCart();
    else closeModal();
  });
  updateCartBadge();
  render();
}
function syncState() {
  state.search = $('search').value;
  state.codes = $('codes').value;
  state.catalog = $('catalogFilter').value;
  state.category = $('categoryFilter').value;
  state.size = $('sizeFilter').value;
  state.color = $('colorFilter').value;
}
function resetFilters() {
  ['search', 'codes', 'catalogFilter', 'categoryFilter', 'sizeFilter', 'colorFilter'].forEach(id => $(id).value = '');
  syncState();
  render();
}
function setView(view) {
  state.view = view;
  document.body.classList.toggle('list', view === 'list');
  $('gridBtn').classList.toggle('primary', view === 'grid');
  $('listBtn').classList.toggle('primary', view === 'list');
}
function filtered() {
  const q = normalizeText(state.search), wantedCodes = getCodes(state.codes), wantedColor = normalizeText(state.color);
  return products.filter(p => {
    const translatedBlob = translateText([p.code, p.name, p.category, p.catalog, p.sizes, p.description, ...p.tech, p.colors.map(c => `${c.code} ${c.name}`).join(' ')].join(' '));
    const blob = normalizeText([translatedBlob, p.code, p.name, p.category, p.catalog, p.sizes, p.description, ...p.tech, p.colors.map(c => `${c.code} ${c.name}`).join(' ')].join(' '));
    if (q && !blob.includes(q)) return false;
    if (wantedCodes.length && !wantedCodes.some(c => normalizeText(p.code).includes(c))) return false;
    if (state.catalog && p.catalog !== state.catalog) return false;
    if (state.category && p.category !== state.category) return false;
    if (state.size && !normalizeText(p.sizes).includes(normalizeText(state.size))) return false;
    if (state.color && !p.colors.some(c => normalizeText(`${c.code} ${c.name}`).includes(wantedColor))) return false;
    return true;
  });
}
function render() {
  const data = filtered();
  $('resultCount').textContent = data.length;
  $('empty').style.display = data.length ? 'none' : 'block';
  const grid = $('grid');
  grid.innerHTML = data.map(card).join('');
  grid.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => openModal(btn.dataset.open)));
}
function card(p) {
  const colorPreview = p.colors.slice(0, 6).map(c => `<span class="swatch">${escapeHtml(c.code)} ${escapeHtml(translateText(c.name))}</span>`).join('') + (p.colors.length > 6 ? `<span class="swatch">+${p.colors.length - 6}</span>` : '');
  return `<article class="product"><div class="thumb"><img loading="lazy" src="${p.image}" alt="${escapeHtml(translateText(p.name))}"><span class="badge">${escapeHtml(p.code)}</span></div><div class="info"><h4>${escapeHtml(translateText(p.name))}</h4><div class="price-row"><span>FOB</span><strong>${escapeHtml(formatFob(p.fobUsd))}</strong></div><div class="meta"><span class="pill">${escapeHtml(translateText(p.category))}</span><span class="pill">${escapeHtml(translateText(p.catalog))}</span></div><p class="desc">${escapeHtml(translateText(p.description || 'Sin descripción cargada.'))}</p><div class="swatches">${colorPreview || '<span class="swatch">Sin colores detectados</span>'}</div><div class="card-actions"><button class="btn primary" data-open="${p.id}">Ver detalle</button><a class="btn" href="${p.pdf}#page=${p.page}" target="_blank">PDF</a></div></div></article>`;
}

function fillCartForm(p) {
  $('cartProductId').value = p.id;
  const sizeSelect = $('cartSize');
  const colorSelect = $('cartColor');
  const sizes = sizesFrom(p.sizes);
  sizeSelect.innerHTML = sizes.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const colors = p.colors.length ? p.colors : [{ code: '-', name: 'Sin color' }];
  colorSelect.innerHTML = colors.map(c => `<option value="${escapeHtml(c.code)}" data-name="${escapeHtml(translateText(c.name))}">${escapeHtml(colorLabel(c))}</option>`).join('');
  $('cartQty').value = 1;
  $('cartFormMsg').hidden = true;
}

function openModal(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  $('modalImage').src = p.image;
  $('modalTitle').textContent = translateText(p.name);
  $('modalCode').textContent = p.code;
  $('modalDesc').textContent = translateText(p.description || '');
  fillCartForm(p);
  $('modalMeta').innerHTML = `<tr><td>FOB</td><td>${escapeHtml(formatFob(p.fobUsd))}</td></tr><tr><td>Catálogo</td><td>${escapeHtml(translateText(p.catalog))}</td></tr><tr><td>Categoría</td><td>${escapeHtml(translateText(p.category))}</td></tr><tr><td>Tallas</td><td>${escapeHtml(p.sizes || 'No detectado')}</td></tr><tr><td>Colores</td><td>${p.colors.map(c => `${escapeHtml(c.code)} ${escapeHtml(translateText(c.name))}`).join('<br>') || 'No detectado'}</td></tr><tr><td>Tecnología</td><td>${p.tech.map(t => escapeHtml(translateText(t))).join(' · ') || 'No detectado'}</td></tr><tr><td>Origen</td><td><a href="${p.pdf}#page=${p.page}" target="_blank">Abrir PDF original, página ${p.page}</a></td></tr>`;
  $('modal').classList.add('open');
}

function closeModal() {
  $('modal').classList.remove('open');
}

function onAddToCart(e) {
  e.preventDefault();
  const productId = $('cartProductId').value;
  const p = products.find(x => x.id === productId);
  if (!p) {
    showCartMsg('No se encontró el producto.', false);
    return;
  }
  const size = $('cartSize').value;
  const colorCode = $('cartColor').value;
  const colorOption = $('cartColor').selectedOptions[0];
  const colorName = colorOption?.dataset.name || colorOption?.textContent || '';
  const qty = Math.max(1, parseInt($('cartQty').value, 10) || 1);
  if (!size || !colorCode) {
    showCartMsg('Elegí talle y color.', false);
    return;
  }
  const incoming = {
    productId: p.id,
    code: p.code,
    name: translateText(p.name),
    size,
    colorCode,
    colorName,
    fobUsd: Number.isFinite(p.fobUsd) ? p.fobUsd : null,
    qty
  };
  const key = cartLineKey(incoming);
  const existing = cart.find(item => cartLineKey(item) === key);
  if (existing) {
    existing.qty += qty;
    if (existing.fobUsd == null && incoming.fobUsd != null) existing.fobUsd = incoming.fobUsd;
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
  $('cartSummary').textContent = total
    ? `${cart.length} línea${cart.length === 1 ? '' : 's'} · ${total} unidad${total === 1 ? '' : 'es'}`
    : 'Sin artículos';
  $('exportCartBtn').disabled = !cart.length;
  $('clearCartBtn').disabled = !cart.length;

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
          <span>Color: <b>${escapeHtml(item.colorCode)}${item.colorName ? ' ' + escapeHtml(item.colorName) : ''}</b></span>
          <span>FOB: <b>${escapeHtml(formatFob(item.fobUsd))}</b></span>
        </div>
      </div>
      <div class="cart-line-actions">
        <label class="cart-qty-label">
          Cant.
          <input type="number" min="1" step="1" value="${item.qty}" data-qty="${index}">
        </label>
        <button type="button" class="btn" data-remove="${index}">Quitar</button>
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

function escapeXml(value) {
  return (value ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function exportCartExcel() {
  if (!cart.length) {
    alert('El pedido está vacío.');
    return;
  }
  const header = ['Codigo', 'Talle', 'Color', 'Cantidad', 'FOB', 'Total FOB'];
  const body = cart.map(item => {
    const fob = Number.isFinite(item.fobUsd) ? item.fobUsd : null;
    const total = fob != null ? fob * Number(item.qty || 0) : null;
    return [
      item.code,
      item.size,
      item.colorName ? `${item.colorCode} ${item.colorName}` : item.colorCode,
      String(item.qty),
      fob != null ? fob.toFixed(4) : '',
      total != null ? total.toFixed(4) : ''
    ];
  });
  const allRows = [header, ...body];
  const numberCols = new Set([3, 4, 5]);
  const xmlRows = allRows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const isNumber = rowIndex > 0 && numberCols.has(colIndex) && cell !== '';
      const type = isNumber ? 'Number' : 'String';
      return `<Cell><Data ss:Type="${type}">${escapeXml(cell)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Pedido">
  <Table>${xmlRows}</Table>
 </Worksheet>
</Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pedido-lupo-${date}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyVisibleCodes() {
  const codes = unique(filtered().map(p => p.code)).join('\n');
  try {
    await navigator.clipboard.writeText(codes);
    $('copyBtn').textContent = 'Copiado';
    setTimeout(() => $('copyBtn').textContent = 'Copiar códigos visibles', 1200);
  } catch (e) {
    alert(codes);
  }
}
init();
