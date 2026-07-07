
const state = { search: '', codes: '', catalog: '', category: '', size: '', color: '', view: 'grid' };
const $ = id => document.getElementById(id);
const products = window.PRODUCTS || [];

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
  return (value || '').split(/[????]/).map(x => x.trim()).filter(Boolean);
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
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
  return `<article class="product"><div class="thumb"><img loading="lazy" src="${p.image}" alt="${escapeHtml(translateText(p.name))}"><span class="badge">${escapeHtml(p.code)}</span><span class="page-badge">P?g. ${p.page}</span></div><div class="info"><h4>${escapeHtml(translateText(p.name))}</h4><div class="price-row"><span>FOB</span><strong>${escapeHtml(formatFob(p.fobUsd))}</strong></div><div class="meta"><span class="pill">${escapeHtml(translateText(p.category))}</span><span class="pill">${escapeHtml(translateText(p.catalog))}</span></div><p class="desc">${escapeHtml(translateText(p.description || 'Sin descripci?n cargada.'))}</p><div class="swatches">${colorPreview || '<span class="swatch">Sin colores detectados</span>'}</div><div class="card-actions"><button class="btn primary" data-open="${p.id}">Ver detalle</button><a class="btn" href="${p.pdf}#page=${p.page}" target="_blank">PDF</a></div></div></article>`;
}

function openModal(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  $('modalImage').src = p.image;
  $('modalTitle').textContent = translateText(p.name);
  $('modalCode').textContent = p.code;
  $('modalDesc').textContent = translateText(p.description || '');
  $('modalMeta').innerHTML = `<tr><td>FOB</td><td>${escapeHtml(formatFob(p.fobUsd))}</td></tr><tr><td>Cat?logo</td><td>${escapeHtml(translateText(p.catalog))}</td></tr><tr><td>Categor?a</td><td>${escapeHtml(translateText(p.category))}</td></tr><tr><td>Tallas</td><td>${escapeHtml(p.sizes || 'No detectado')}</td></tr><tr><td>Colores</td><td>${p.colors.map(c => `${escapeHtml(c.code)} ${escapeHtml(translateText(c.name))}`).join('<br>') || 'No detectado'}</td></tr><tr><td>Tecnolog?a</td><td>${p.tech.map(t => escapeHtml(translateText(t))).join(' ? ') || 'No detectado'}</td></tr><tr><td>Origen</td><td><a href="${p.pdf}#page=${p.page}" target="_blank">Abrir PDF original, p?gina ${p.page}</a></td></tr>`;
  $('modal').classList.add('open');
}

function closeModal() {
  $('modal').classList.remove('open');
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
