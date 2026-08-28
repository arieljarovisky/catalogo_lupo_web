const { escapeHtml, translateText, formatArs, formatFob, parseArs, api, logout, normalizeText, catalogLabel, setCustomLabels, badgeLabel } = window.LupoCommon;

const $ = id => document.getElementById(id);
const PRODUCT_TAB_SCOPES = { 'products-local': 'local', 'products-brasil': 'brasil' };
let products = [];
let catalogs = [];
let labels = [];
let lists = [];
let currentListId = '';
let currentPrices = {};
let dirtyPrices = {};
let users = [];
let editingId = '';
let productScope = 'local';
let activeTab = 'products-local';

function productOrigin(p) {
  return p?.origin === 'local' ? 'local' : 'brasil';
}

function productsInScope(scope = productScope) {
  return products.filter(p => productOrigin(p) === scope);
}

function showFlash(text, err = false) {
  const el = $('flash');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('err', err);
  if (text) setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 2800);
}

function panelIdForTab(tab) {
  if (PRODUCT_TAB_SCOPES[tab]) return 'products';
  return tab;
}

function updateProductScopeUI() {
  const local = productScope === 'local';
  const blurb = $('productScopeBlurb');
  if (blurb) {
    blurb.textContent = local
      ? 'Productos que importás y vendés a tus mayoristas. Publicar u ocultar define lo que ven tus clientes.'
      : 'Línea completa de Lupo Brasil. No se publica al catálogo de clientes: se usa para pedir a fábrica en FOB.';
  }
  document.querySelectorAll('[data-local-only]').forEach(el => { el.hidden = !local; });
  document.querySelectorAll('[data-brasil-only]').forEach(el => { el.hidden = local; });
}

function switchTab(tab) {
  activeTab = tab;
  document.body.classList.toggle('admin-brasil-scope', tab === 'products-brasil');
  const scope = PRODUCT_TAB_SCOPES[tab];
  if (scope) {
    productScope = scope;
    if ($('productCatalogFilter')) $('productCatalogFilter').value = '';
    if ($('selectAllProducts')) $('selectAllProducts').checked = false;
    updateProductScopeUI();
    fillCatalogFilters();
    renderProducts();
  }
  if (tab === 'labels') renderLabels();
  const panelId = panelIdForTab(tab);
  document.querySelectorAll('.admin-tabs [data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${panelId}`));
}

function catalogOptionsHtml(list) {
  const catalogNames = [...new Set(list.map(p => p.catalog))].sort((a, b) => {
    const al = LINGERIE_CATALOGS.has(a) ? 0 : 1;
    const bl = LINGERIE_CATALOGS.has(b) ? 0 : 1;
    if (al !== bl) return al - bl;
    return catalogLabel(a).localeCompare(catalogLabel(b), 'es');
  });
  return `<option value="">Todos los catálogos</option>` + catalogNames.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(catalogLabel(c))}</option>`).join('');
}

function fillCatalogFilters() {
  if ($('productCatalogFilter')) $('productCatalogFilter').innerHTML = catalogOptionsHtml(productsInScope());
  if ($('priceCatalogFilter')) $('priceCatalogFilter').innerHTML = catalogOptionsHtml(productsInScope('local'));
}

const LINGERIE_CATALOGS = new Set(['Lencería 2026', 'Lupo Lingerie PV 2026']);

function filteredProducts() {
  const q = normalizeText($('productSearch').value);
  const catalog = $('productCatalogFilter')?.value || '';
  const fob = $('productFobFilter')?.value || '';
  return productsInScope().filter(p => {
    if (catalog && p.catalog !== catalog) return false;
    if (fob === 'with' && !Number.isFinite(p.fobUsd)) return false;
    if (fob === 'without' && Number.isFinite(p.fobUsd)) return false;
    const blob = normalizeText([p.code, translateText(p.name), catalogLabel(p.catalog), p.catalog, p.category].join(' '));
    return !q || blob.includes(q);
  }).sort((a, b) => {
    const al = LINGERIE_CATALOGS.has(a.catalog) ? 0 : 1;
    const bl = LINGERIE_CATALOGS.has(b.catalog) ? 0 : 1;
    if (al !== bl) return al - bl;
    const ao = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.POSITIVE_INFINITY;
    const bo = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true });
  });
}

function badgeOptions(selected) {
  return `<option value="">Sin etiqueta</option>` + labels.map(b =>
    `<option value="${escapeHtml(b.id)}" ${selected === b.id ? 'selected' : ''}>${escapeHtml(b.name || b.label || b.id)}</option>`
  ).join('');
}

function fillBadgeSelects() {
  const html = badgeOptions('');
  if ($('bulkBadge')) {
    const current = $('bulkBadge').value;
    $('bulkBadge').innerHTML = html;
    if (current && labels.some(l => l.id === current)) $('bulkBadge').value = current;
  }
  if ($('editorBadge')) {
    const current = $('editorBadge').value;
    $('editorBadge').innerHTML = html;
    if (current && labels.some(l => l.id === current)) $('editorBadge').value = current;
  }
}

function labelPreviewStyle(label) {
  return label?.color ? `background:${label.color}` : '';
}

function renderLabels() {
  if (!$('labelRows')) return;
  $('labelRows').innerHTML = labels.map(l => `
    <tr data-label="${escapeHtml(l.id)}">
      <td><span class="mini-tag" style="${escapeHtml(labelPreviewStyle(l))}">${escapeHtml(l.name)}</span></td>
      <td><input type="text" data-label-name value="${escapeHtml(l.name)}" maxlength="40"></td>
      <td><input type="color" data-label-color value="${escapeHtml(l.color || '#111111')}"></td>
      <td><label class="label-check"><input type="checkbox" data-label-promo ${l.promoTab ? 'checked' : ''}> Promociones</label></td>
      <td>
        <button class="btn btn-ghost" type="button" data-save-label="${escapeHtml(l.id)}">Guardar</button>
        <button class="btn btn-ghost" type="button" data-delete-label="${escapeHtml(l.id)}">Eliminar</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">Todavía no hay etiquetas.</td></tr>';
}

function adminImage(p) {
  const src = String(p.image || '');
  if (!src || src.startsWith('http') || src.includes('?')) return src;
  return `${src}?v=4`;
}

function pdfHref(p) {
  if (!p.pdf) return '';
  const base = p.pdf.startsWith('http') ? p.pdf : `/${p.pdf.replace(/^\//, '')}`;
  return p.page ? `${base}#page=${p.page}` : base;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderProducts() {
  const rows = filteredProducts();
  const scoped = productsInScope();
  const published = scoped.filter(p => p.published).length;
  const withFob = scoped.filter(p => Number.isFinite(p.fobUsd)).length;
  const local = productScope === 'local';
  $('productStats').textContent = local
    ? `${published} publicados · ${rows.length} en vista · ${scoped.length} en Argentina · ${withFob} con FOB`
    : `${rows.length} en vista · ${scoped.length} en Brasil · ${withFob} con FOB`;
  $('productRows').innerHTML = rows.map(p => {
    const href = pdfHref(p);
    const orderVal = Number.isFinite(p.sortOrder) ? p.sortOrder : '';
    return `
    <tr data-product="${escapeHtml(p.id)}">
      <td class="col-local-only"><input type="checkbox" data-id="${escapeHtml(p.id)}" ${p.published ? 'checked' : ''}></td>
      <td><button class="thumb-edit" type="button" data-edit="${escapeHtml(p.id)}" title="Editar foto"><img class="thumb-mini" src="${escapeHtml(adminImage(p))}" alt=""></button></td>
      <td class="col-local-only"><input class="sort-order-input" type="number" min="0" step="1" inputmode="numeric" data-sort="${escapeHtml(p.id)}" value="${escapeHtml(String(orderVal))}" placeholder="—" title="Menor número = aparece antes"></td>
      <td><b>${escapeHtml(p.code)}</b></td>
      <td>${escapeHtml(translateText(p.name))}</td>
      <td>${escapeHtml(catalogLabel(p.catalog))}</td>
      <td>${escapeHtml(formatFob(p.fobUsd))}</td>
      <td>${href ? `<a class="btn btn-ghost" href="${escapeHtml(href)}" target="_blank" rel="noopener">PDF</a>` : '—'}</td>
      <td class="col-local-only">
        <select data-badge="${escapeHtml(p.id)}">${badgeOptions(p.badge)}</select>
        ${p.badge ? `<div class="mini-tag" style="${escapeHtml(labelPreviewStyle(labels.find(l => l.id === p.badge)))}">${escapeHtml(badgeLabel(p.badge, p.badgeText))}</div>` : ''}
      </td>
      <td class="col-local-only"><span class="status-pill ${p.published ? 'on' : 'off'}">${p.published ? 'Visible' : 'Oculto'}</span></td>
      <td><button class="btn btn-ghost" type="button" data-edit="${escapeHtml(p.id)}">Editar</button></td>
    </tr>`;
  }).join('');
}

function catalogRowHtml(c) {
  const href = c.pdf ? `/${String(c.pdf).replace(/^\//, '')}` : '';
  return `<tr>
    <td><b>${escapeHtml(catalogLabel(c.name))}</b><div class="muted" style="font-size:12px;">${escapeHtml(c.name)}</div></td>
    <td>${c.productCount || 0}</td>
    <td>${c.fobCount || 0}</td>
    <td>${escapeHtml(formatBytes(c.size))}</td>
    <td>${c.exists && href ? `<a class="btn btn-black" href="${escapeHtml(href)}" target="_blank" rel="noopener">Abrir PDF</a>` : '<span class="muted">No encontrado</span>'}</td>
  </tr>`;
}

function renderCatalogs() {
  if (!$('catalogRowsLocal') || !$('catalogRowsBrasil')) return;
  const local = catalogs.filter(c => c.origin === 'local');
  const brasil = catalogs.filter(c => c.origin !== 'local');
  const localCount = local.reduce((n, c) => n + (c.productCount || 0), 0);
  const brasilCount = brasil.reduce((n, c) => n + (c.productCount || 0), 0);
  const withFob = brasil.reduce((n, c) => n + (c.fobCount || 0), 0);
  $('catalogStats').textContent = `${local.length} catálogos Argentina (${localCount} art.) · ${brasil.length} Brasil (${brasilCount} art., ${withFob} con FOB)`;
  $('catalogRowsLocal').innerHTML = local.map(catalogRowHtml).join('') || '<tr><td colspan="5" class="muted">No hay catálogos de Argentina.</td></tr>';
  $('catalogRowsBrasil').innerHTML = brasil.map(catalogRowHtml).join('') || '<tr><td colspan="5" class="muted">No hay catálogos de Brasil.</td></tr>';
}

function upsertProduct(updated) {
  const idx = products.findIndex(p => p.id === updated.id);
  if (idx >= 0) products[idx] = { ...products[idx], ...updated };
  if (editingId === updated.id) fillEditor(updated);
}

function fillEditor(p) {
  $('editorTitle').textContent = p.name;
  $('editorCode').textContent = p.code;
  $('editorImage').src = adminImage(p);
  $('editorName').value = p.name || '';
  if ($('editorBadge')) {
    $('editorBadge').innerHTML = badgeOptions(p.badge || '');
    $('editorBadge').value = p.badge || '';
  }
  $('editorBadgeText').value = p.badgeText || '';
  if ($('editorSortOrder')) $('editorSortOrder').value = Number.isFinite(p.sortOrder) ? p.sortOrder : '';
  $('restoreImageBtn').disabled = !p.hasCustomImage;
  $('restoreNameBtn').disabled = !p.hasCustomName;
  renderEditorColors(p);
}

function colorLabelAdmin(c) {
  const name = translateText(c.name || '').trim();
  if (name) return name;
  const code = String(c.code || '').trim();
  return !code || code === '-' ? 'Sin color' : code;
}

function renderEditorColors(p) {
  const wrap = $('editorColorPhotos');
  if (!wrap) return;
  const colors = p.colors || [];
  if (!colors.length) {
    wrap.innerHTML = '<p class="muted" style="margin:0;font-size:13px;">Sin colores cargados.</p>';
    return;
  }
  wrap.innerHTML = colors.map(c => {
    const src = c.image || '';
    const img = src ? `<img src="${escapeHtml(src)}" alt="">` : '<span class="editor-color-empty">Sin foto</span>';
    return `<article class="editor-color-card" data-color-code="${escapeHtml(c.code)}">
      <div class="editor-color-thumb">${img}</div>
      <div class="editor-color-info">
        <strong>${escapeHtml(colorLabelAdmin(c))}</strong>
        <span class="muted">${escapeHtml(c.code || '')}</span>
        <div class="editor-color-actions">
          <label class="btn btn-ghost editor-color-upload">Cambiar<input type="file" accept="image/jpeg,image/png,image/webp" data-color-file="${escapeHtml(c.code)}" hidden></label>
          <button type="button" class="btn btn-ghost" data-color-restore="${escapeHtml(c.code)}" ${c.hasCustomImage ? '' : 'disabled'}>Original</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

function openEditor(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  fillBadgeSelects();
  fillEditor(p);
  $('productEditor').hidden = false;
  $('editorFile').value = '';
}

function closeEditor() {
  editingId = '';
  $('productEditor').hidden = true;
  $('editorFile').value = '';
}

async function setVisibility(ids, published) {
  if (!ids.length) return showFlash('No hay productos para actualizar.', true);
  await api('/api/admin/products/visibility', { method: 'PATCH', body: { ids, published } });
  const set = new Set(ids);
  products.forEach(p => { if (set.has(p.id)) p.published = published; });
  renderProducts();
  showFlash(published ? 'Productos publicados.' : 'Productos ocultados.');
}

function selectedProductIds() {
  return [...document.querySelectorAll('#productRows input[type="checkbox"]:checked')].map(el => el.dataset.id);
}

function fillListSelects() {
  const options = lists.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)} (${l.pricedCount} precios)</option>`).join('');
  $('listSelect').innerHTML = options;
  $('userList').innerHTML = lists.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');
  if (currentListId) $('listSelect').value = currentListId;
  document.querySelectorAll('[data-user-list]').forEach(sel => {
    const current = sel.dataset.current;
    sel.innerHTML = lists.map(l => `<option value="${escapeHtml(l.id)}" ${l.id === current ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('');
  });
}

function filteredPriceProducts() {
  const q = normalizeText($('priceSearch').value);
  const catalog = $('priceCatalogFilter')?.value || '';
  return productsInScope('local').filter(p => {
    if (catalog && p.catalog !== catalog) return false;
    const blob = normalizeText([p.code, translateText(p.name), catalogLabel(p.catalog), p.catalog].join(' '));
    return !q || blob.includes(q);
  });
}

function priceValue(productId) {
  if (Object.prototype.hasOwnProperty.call(dirtyPrices, productId)) return dirtyPrices[productId];
  return currentPrices[productId];
}

function renderPrices() {
  const rows = filteredPriceProducts();
  const priced = Object.values({ ...currentPrices, ...dirtyPrices }).filter(v => Number.isFinite(v)).length;
  const dirtyCount = Object.keys(dirtyPrices).length;
  $('listStats').textContent = `${priced} con precio · ${dirtyCount} cambios sin guardar`;
  $('priceRows').innerHTML = rows.map(p => {
    const value = priceValue(p.id);
    const display = Number.isFinite(value) ? String(value) : '';
    return `<tr>
      <td><b>${escapeHtml(p.code)}</b></td>
      <td>${escapeHtml(translateText(p.name))}</td>
      <td>${escapeHtml(formatFob(p.fobUsd))}</td>
      <td><input type="text" inputmode="decimal" data-price="${escapeHtml(p.id)}" value="${escapeHtml(display)}" placeholder="Consultar"></td>
    </tr>`;
  }).join('');
}

async function loadList(id) {
  currentListId = id;
  dirtyPrices = {};
  const data = await api(`/api/admin/lists/${id}`);
  currentPrices = data.list.prices || {};
  $('listRename').value = data.list.name;
  $('listSelect').value = id;
  renderPrices();
}

function renderUsers() {
  $('userRows').innerHTML = users.map(u => `
    <tr data-user="${escapeHtml(u.id)}">
      <td><b>${escapeHtml(u.username)}</b></td>
      <td><input type="text" data-name value="${escapeHtml(u.name || '')}"></td>
      <td>
        <select data-role>
          <option value="cliente" ${u.role === 'cliente' ? 'selected' : ''}>Cliente</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
      </td>
      <td>
        <select data-user-list data-current="${escapeHtml(u.priceListId || '')}">
          ${lists.map(l => `<option value="${escapeHtml(l.id)}" ${l.id === u.priceListId ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </td>
      <td><input type="password" data-pass placeholder="Opcional"></td>
      <td>
        <button class="btn btn-ghost" data-save-user type="button">Guardar</button>
        <button class="btn btn-ghost" data-delete-user type="button">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

async function refreshLists() {
  lists = (await api('/api/admin/lists')).lists;
  if (!currentListId && lists[0]) currentListId = lists[0].id;
  if (currentListId && !lists.some(l => l.id === currentListId) && lists[0]) currentListId = lists[0].id;
  fillListSelects();
}

async function refreshUsers() {
  users = (await api('/api/admin/users')).users;
  renderUsers();
}

async function refreshLabels() {
  const data = await api('/api/admin/labels');
  labels = data.labels || [];
  setCustomLabels(labels.map(l => ({ id: l.id, name: l.name, color: l.color, promoTab: l.promoTab })));
  fillBadgeSelects();
  renderLabels();
}

async function init() {
  const me = await api('/api/me');
  if (me.user.role !== 'admin') {
    window.location.href = '/';
    return;
  }
  $('adminUserLabel').textContent = `${me.user.name || me.user.username}`;
  await refreshLabels();
  products = (await api('/api/admin/products')).products;
  catalogs = (await api('/api/admin/catalogs')).catalogs || [];
  updateProductScopeUI();
  fillCatalogFilters();
  await refreshLists();
  await loadList(currentListId);
  await refreshUsers();
  renderProducts();
  renderCatalogs();

  document.querySelectorAll('.admin-tabs [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  $('logoutBtn').addEventListener('click', logout);
  $('newLabelForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/labels', {
        method: 'POST',
        body: {
          name: $('newLabelName').value.trim(),
          color: $('newLabelColor').value,
          promoTab: $('newLabelPromoTab').checked
        }
      });
      $('newLabelName').value = '';
      $('newLabelPromoTab').checked = true;
      await refreshLabels();
      renderProducts();
      showFlash('Etiqueta creada.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('labelRows')?.addEventListener('click', async e => {
    const saveBtn = e.target.closest('[data-save-label]');
    const deleteBtn = e.target.closest('[data-delete-label]');
    const row = e.target.closest('tr[data-label]');
    if (!row) return;
    const id = row.dataset.label;
    if (saveBtn) {
      try {
        await api(`/api/admin/labels/${id}`, {
          method: 'PATCH',
          body: {
            name: row.querySelector('[data-label-name]').value.trim(),
            color: row.querySelector('[data-label-color]').value,
            promoTab: row.querySelector('[data-label-promo]').checked
          }
        });
        await refreshLabels();
        renderProducts();
        showFlash('Etiqueta actualizada.');
      } catch (err) { showFlash(err.message, true); }
      return;
    }
    if (deleteBtn) {
      if (!confirm('¿Eliminar esta etiqueta? Se la quita de los productos que la tengan.')) return;
      try {
        await api(`/api/admin/labels/${id}`, { method: 'DELETE' });
        await refreshLabels();
        products = (await api('/api/admin/products')).products;
        renderProducts();
        showFlash('Etiqueta eliminada.');
      } catch (err) { showFlash(err.message, true); }
    }
  });
  $('productSearch').addEventListener('input', renderProducts);
  $('productCatalogFilter').addEventListener('change', renderProducts);
  $('productFobFilter')?.addEventListener('change', renderProducts);
  $('priceCatalogFilter').addEventListener('change', renderPrices);
  $('selectAllProducts').addEventListener('change', () => {
    setVisibility(filteredProducts().map(p => p.id), $('selectAllProducts').checked)
      .catch(err => showFlash(err.message, true));
  });
  $('productRows').addEventListener('change', e => {
    const box = e.target.closest('input[type="checkbox"][data-id]');
    if (box) {
      setVisibility([box.dataset.id], box.checked).catch(err => showFlash(err.message, true));
      return;
    }
    const sortInput = e.target.closest('input[data-sort]');
    if (sortInput) {
      const raw = sortInput.value.trim();
      const sortOrder = raw === '' ? null : Number(raw);
      api(`/api/admin/products/${sortInput.dataset.sort}`, { method: 'PATCH', body: { sortOrder } })
        .then(data => {
          upsertProduct(data.product);
          renderProducts();
          showFlash('Orden actualizado.');
        })
        .catch(err => showFlash(err.message, true));
      return;
    }
    const badgeSel = e.target.closest('select[data-badge]');
    if (!badgeSel) return;
    api(`/api/admin/products/${badgeSel.dataset.badge}`, { method: 'PATCH', body: { badge: badgeSel.value } })
      .then(data => {
        upsertProduct(data.product);
        renderProducts();
        showFlash('Etiqueta actualizada.');
      })
      .catch(err => showFlash(err.message, true));
  });
  $('productRows').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit]');
    if (edit) openEditor(edit.dataset.edit);
  });
  $('applyBulkBadge').addEventListener('click', async () => {
    const ids = filteredProducts().map(p => p.id);
    if (!ids.length) return showFlash('No hay productos filtrados.', true);
    try {
      await api('/api/admin/products/badges', { method: 'PATCH', body: { ids, badge: $('bulkBadge').value, badgeText: '' } });
      const badge = $('bulkBadge').value;
      products.forEach(p => {
        if (ids.includes(p.id)) {
          p.badge = badge;
          if (!badge) p.badgeText = '';
        }
      });
      renderProducts();
      showFlash('Etiqueta aplicada a los productos filtrados.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('closeEditor').addEventListener('click', closeEditor);
  $('productEditor').addEventListener('click', e => {
    if (e.target.closest('[data-close-editor]')) closeEditor();
  });
  $('editorFile').addEventListener('change', async () => {
    const file = $('editorFile').files[0];
    if (!file || !editingId) return;
    if (file.size > 6 * 1024 * 1024) return showFlash('La imagen no puede superar 6 MB.', true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      const data = await api(`/api/admin/products/${editingId}/image`, { method: 'POST', body: { dataUrl } });
      upsertProduct(data.product);
      renderProducts();
      showFlash('Foto actualizada.');
    } catch (err) { showFlash(err.message, true); }
    $('editorFile').value = '';
  });
  $('editorColorPhotos')?.addEventListener('change', async e => {
    const input = e.target.closest('[data-color-file]');
    if (!input || !editingId) return;
    const file = input.files?.[0];
    const code = input.dataset.colorFile;
    input.value = '';
    if (!file || !code) return;
    if (file.size > 6 * 1024 * 1024) return showFlash('La imagen no puede superar 6 MB.', true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      const data = await api(`/api/admin/products/${editingId}/colors/${encodeURIComponent(code)}/image`, {
        method: 'POST',
        body: { dataUrl }
      });
      upsertProduct(data.product);
      renderProducts();
      showFlash('Foto del color actualizada.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('editorColorPhotos')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-color-restore]');
    if (!btn || !editingId || btn.disabled) return;
    const code = btn.dataset.colorRestore;
    try {
      const data = await api(`/api/admin/products/${editingId}/colors/${encodeURIComponent(code)}/image`, {
        method: 'DELETE'
      });
      upsertProduct(data.product);
      renderProducts();
      showFlash('Se restauró la foto original del color.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('restoreNameBtn').addEventListener('click', async () => {
    if (!editingId) return;
    const p = products.find(x => x.id === editingId);
    if (!p) return;
    try {
      const data = await api(`/api/admin/products/${editingId}`, { method: 'PATCH', body: { name: p.originalName || '' } });
      upsertProduct(data.product);
      renderProducts();
      showFlash('Se restauró el título original.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('restoreImageBtn').addEventListener('click', async () => {
    if (!editingId) return;
    try {
      const data = await api(`/api/admin/products/${editingId}/image`, { method: 'DELETE' });
      upsertProduct(data.product);
      renderProducts();
      showFlash('Se restauró la foto original.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('saveEditorBtn').addEventListener('click', async () => {
    if (!editingId) return;
    try {
      const name = $('editorName').value.trim();
      if (!name) return showFlash('El título no puede quedar vacío.', true);
      const data = await api(`/api/admin/products/${editingId}`, {
        method: 'PATCH',
        body: {
          name,
          badge: $('editorBadge').value,
          badgeText: $('editorBadgeText').value,
          sortOrder: $('editorSortOrder')?.value.trim() === '' ? null : Number($('editorSortOrder').value)
        }
      });
      upsertProduct(data.product);
      renderProducts();
      showFlash('Cambios guardados.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('publishFiltered').addEventListener('click', () => {
    setVisibility(filteredProducts().map(p => p.id), true).catch(err => showFlash(err.message, true));
  });
  $('hideFiltered').addEventListener('click', () => {
    setVisibility(filteredProducts().map(p => p.id), false).catch(err => showFlash(err.message, true));
  });

  $('newListForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const name = $('newListName').value.trim();
      const created = await api('/api/admin/lists', { method: 'POST', body: { name } });
      $('newListName').value = '';
      await refreshLists();
      await loadList(created.list.id);
      showFlash('Lista creada.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('listSelect').addEventListener('change', async () => {
    if (Object.keys(dirtyPrices).length && !confirm('Hay precios sin guardar. ¿Cambiar de lista igual?')) {
      $('listSelect').value = currentListId;
      return;
    }
    try { await loadList($('listSelect').value); }
    catch (err) { showFlash(err.message, true); }
  });
  $('renameListBtn').addEventListener('click', async () => {
    try {
      const name = $('listRename').value.trim();
      await api(`/api/admin/lists/${currentListId}`, { method: 'PATCH', body: { name } });
      await refreshLists();
      showFlash('Lista renombrada.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('deleteListBtn').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta lista? Los usuarios pasarán a otra lista.')) return;
    try {
      await api(`/api/admin/lists/${currentListId}`, { method: 'DELETE' });
      currentListId = '';
      await refreshLists();
      await loadList(currentListId);
      await refreshUsers();
      showFlash('Lista eliminada.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('priceSearch').addEventListener('input', renderPrices);
  $('priceRows').addEventListener('input', e => {
    const input = e.target.closest('[data-price]');
    if (!input) return;
    const parsed = parseArs(input.value);
    dirtyPrices[input.dataset.price] = parsed;
    $('listStats').textContent = `${Object.values({ ...currentPrices, ...dirtyPrices }).filter(v => Number.isFinite(v)).length} con precio · ${Object.keys(dirtyPrices).length} cambios sin guardar`;
  });
  $('applyBulkPrice').addEventListener('click', () => {
    const parsed = parseArs($('bulkPrice').value);
    filteredPriceProducts().forEach(p => {
      dirtyPrices[p.id] = parsed;
    });
    renderPrices();
  });
  $('savePricesBtn').addEventListener('click', async () => {
    if (!Object.keys(dirtyPrices).length) return showFlash('No hay cambios para guardar.');
    try {
      await api(`/api/admin/lists/${currentListId}/prices`, { method: 'PATCH', body: { prices: dirtyPrices } });
      Object.assign(currentPrices, dirtyPrices);
      for (const [id, value] of Object.entries(dirtyPrices)) {
        if (value == null) delete currentPrices[id];
      }
      dirtyPrices = {};
      await refreshLists();
      renderPrices();
      showFlash('Precios guardados.');
    } catch (err) { showFlash(err.message, true); }
  });

  $('userForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: {
          name: $('userNameInput').value,
          username: $('userUsername').value,
          password: $('userPassword').value,
          role: $('userRole').value,
          priceListId: $('userList').value
        }
      });
      $('userForm').reset();
      await refreshUsers();
      showFlash('Usuario creado.');
    } catch (err) { showFlash(err.message, true); }
  });
  $('userRows').addEventListener('click', async e => {
    const row = e.target.closest('tr[data-user]');
    if (!row) return;
    const id = row.dataset.user;
    try {
      if (e.target.closest('[data-save-user]')) {
        const body = {
          name: row.querySelector('[data-name]').value,
          role: row.querySelector('[data-role]').value,
          priceListId: row.querySelector('[data-user-list]').value
        };
        const pass = row.querySelector('[data-pass]').value;
        if (pass) body.password = pass;
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body });
        await refreshUsers();
        showFlash('Usuario actualizado.');
      }
      if (e.target.closest('[data-delete-user]')) {
        if (!confirm('¿Eliminar este usuario?')) return;
        await api(`/api/admin/users/${id}`, { method: 'DELETE' });
        await refreshUsers();
        showFlash('Usuario eliminado.');
      }
    } catch (err) { showFlash(err.message, true); }
  });

  try {
    const settings = await api('/api/admin/settings');
    $('whatsappNumber').value = settings.whatsappNumber || '';
  } catch {}
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const saved = await api('/api/admin/settings', {
        method: 'PATCH',
        body: { whatsappNumber: $('whatsappNumber').value }
      });
      $('whatsappNumber').value = saved.whatsappNumber || '';
      showFlash('WhatsApp guardado. Los pedidos te van a llegar ahí con el Excel.');
    } catch (err) { showFlash(err.message, true); }
  });
}

init().catch(err => {
  if (err.message !== 'No autenticado') {
    console.error(err);
    showFlash(err.message || 'No se pudo cargar el panel', true);
  }
});
