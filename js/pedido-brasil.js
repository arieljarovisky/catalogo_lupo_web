(() => {
  const { escapeHtml, translateText, normalizeText, formatFob, api, logout } = window.LupoCommon;
  const $ = id => document.getElementById(id);
  const SURTIDO_COLOR = 'SURTIDO';

  let currentUser = null;
  let products = [];
  let cart = [];
  let cartNotes = '';
  let productById = new Map();
  let productByCode = new Map();

  function cartStorageKey() {
    return `lupo-cart-v2-brasil-${currentUser?.username || 'anon'}`;
  }
  function notesStorageKey() {
    return `lupo-cart-notes-v1-brasil-${currentUser?.username || 'anon'}`;
  }
  function assetUrl(src) {
    const value = String(src || '');
    if (!value || value.startsWith('http') || value.includes('?')) return value;
    return `${value}?v=4`;
  }
  function normalizeCodeKey(code) {
    return String(code || '').trim().toUpperCase().replace(/^0+/, '').replace(/[^A-Z0-9]/g, '');
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
  }
  function cartTotalQty() {
    return cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  }
  function cartTotalMoney() {
    return cart.reduce((sum, item) => {
      if (!Number.isFinite(item.fobUsd)) return sum;
      return sum + item.fobUsd * Number(item.qty || 0);
    }, 0);
  }
  function showFlash(text, err = false) {
    const el = $('flash');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('err', err);
  }
  function findProduct(item) {
    if (item.productId && productById.has(item.productId)) return productById.get(item.productId);
    const key = normalizeCodeKey(item.code);
    return productByCode.get(key) || null;
  }
  function lineImage(item) {
    if (item.image) return assetUrl(item.image);
    const product = findProduct(item);
    if (!product) return '';
    const code = String(item.colorCode || '');
    if (code && code !== SURTIDO_COLOR && code !== '-') {
      const color = (product.colors || []).find(c => String(c.code) === code);
      if (color?.image) return assetUrl(color.image);
      const byName = (product.colors || []).find(c => normalizeText(c.name) === normalizeText(item.colorName || ''));
      if (byName?.image) return assetUrl(byName.image);
    }
    return assetUrl(product.image);
  }
  function enrichCartImages() {
    cart = cart.map(item => {
      const src = lineImage(item);
      return src ? { ...item, image: src.replace(/\?v=\d+$/, '') } : item;
    });
    saveCart();
  }
  function updateSummary() {
    const total = cartTotalQty();
    const money = cartTotalMoney();
    $('pedidoSummary').textContent = total
      ? `${cart.length} línea${cart.length === 1 ? '' : 's'} · ${total} unidad${total === 1 ? '' : 'es'} · ${formatFob(money)}`
      : 'Sin artículos';
    $('sendBtn').disabled = !cart.length;
    $('clearBtn').disabled = !cart.length;
  }
  function render() {
    updateSummary();
    const grid = $('pedidoGrid');
    if (!cart.length) {
      grid.innerHTML = `<div class="pedido-empty">
        <p>Todavía no hay productos en el pedido Brasil.</p>
        <a class="btn btn-black" href="/brasil">Ir al catálogo Brasil</a>
      </div>`;
      return;
    }
    grid.innerHTML = cart.map((item, index) => {
      const src = lineImage(item);
      const img = src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.name || item.code)}" loading="lazy">`
        : `<div class="pedido-thumb-empty">Sin foto</div>`;
      return `<article class="pedido-card" data-index="${index}">
        <div class="pedido-thumb">${img}</div>
        <div class="pedido-card-body">
          <strong class="pedido-code">${escapeHtml(item.code)}</strong>
          <h3>${escapeHtml(item.name || '')}</h3>
          <div class="pedido-meta">
            <span>Talle <b>${escapeHtml(item.size || '—')}</b></span>
            <span>Color <b>${escapeHtml(item.colorName || item.colorCode || '—')}</b></span>
            <span>FOB <b>${escapeHtml(Number.isFinite(item.fobUsd) ? formatFob(item.fobUsd) : 'Consultar')}</b></span>
          </div>
          <div class="pedido-card-actions">
            <label class="cart-qty-label">
              Cant.
              <input type="number" min="1" step="1" value="${item.qty}" data-qty="${index}">
            </label>
            <button type="button" class="btn btn-ghost" data-remove="${index}">Quitar</button>
          </div>
        </div>
      </article>`;
    }).join('');
  }
  function downloadExcelFile(xml, filename) {
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'pedido-brasil.xls';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function sendOrder() {
    if (!cart.length) return;
    $('sendBtn').disabled = true;
    try {
      const data = await api('/api/admin/orders-brasil', {
        method: 'POST',
        body: { items: cart, notes: cartNotes }
      });
      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, '_blank', 'noopener');
        return;
      }
      const file = new File([data.xml], data.filename || 'pedido-brasil.xls', { type: 'application/vnd.ms-excel' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Pedido Brasil Lupo', text: data.message });
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
      if (data.xml) downloadExcelFile(data.xml, data.filename);
      window.open(`https://wa.me/?text=${encodeURIComponent(data.message || 'Pedido Brasil Lupo')}`, '_blank', 'noopener');
      showFlash('Configurá WhatsApp en Administración para envío directo.', true);
    } catch (err) {
      showFlash(err.message || 'No se pudo enviar el pedido.', true);
    } finally {
      $('sendBtn').disabled = !cart.length;
    }
  }

  async function init() {
    const me = await api('/api/me');
    currentUser = me.user;
    if (currentUser.role !== 'admin') {
      window.location.href = '/';
      return;
    }
    const catalog = await api('/api/admin/catalog-brasil');
    products = catalog.products || [];
    productById = new Map(products.map(p => [p.id, p]));
    productByCode = new Map();
    for (const p of products) {
      const key = normalizeCodeKey(p.code);
      if (key && !productByCode.has(key)) productByCode.set(key, p);
    }
    cart = loadCart();
    cartNotes = loadNotes();
    enrichCartImages();
    $('pedidoNotes').value = cartNotes;
    render();

    $('pedidoNotes').addEventListener('input', () => {
      cartNotes = $('pedidoNotes').value.slice(0, 800);
      saveCart();
    });
    $('pedidoGrid').addEventListener('click', e => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      const index = Number(btn.dataset.remove);
      if (!Number.isInteger(index)) return;
      cart.splice(index, 1);
      saveCart();
      render();
    });
    $('pedidoGrid').addEventListener('change', e => {
      const input = e.target.closest('[data-qty]');
      if (!input) return;
      const index = Number(input.dataset.qty);
      if (!Number.isInteger(index) || !cart[index]) return;
      cart[index].qty = Math.max(1, parseInt(input.value, 10) || 1);
      input.value = cart[index].qty;
      saveCart();
      updateSummary();
    });
    $('clearBtn').addEventListener('click', () => {
      if (!cart.length || !confirm('¿Vaciar todo el pedido Brasil?')) return;
      cart = [];
      saveCart();
      render();
    });
    $('sendBtn').addEventListener('click', sendOrder);
  }

  init().catch(err => {
    showFlash(err.message || 'No se pudo abrir la vista del pedido.', true);
  });
})();
