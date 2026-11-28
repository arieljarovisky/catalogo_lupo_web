/**
 * Stock desde LupoHub (sistema de gestión mayorista, en Railway).
 * Se activa con LUPOHUB_API_URL y LUPOHUB_API_KEY; sin ellas el catálogo usa el stock
 * cargado a mano en el admin, como antes.
 *
 * LupoHub expone GET /api/catalog-stock con filas { sku, colorCode, colorName, size, stock }.
 * Acá se cruzan con los productos del catálogo por código de artículo, color y talle.
 */
const API_URL = String(process.env.LUPOHUB_API_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.LUPOHUB_API_KEY || '').trim();
const USE_LUPOHUB = Boolean(API_URL && API_KEY);
const CACHE_MS = Number(process.env.LUPOHUB_STOCK_CACHE_MS) || 60_000;
const TIMEOUT_MS = 8000;

let cache = { at: 0, items: null, error: null };
let inflight = null;

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo dígitos, sin ceros a la izquierda: "0017800" y "17800" son el mismo artículo. */
function digitsKey(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  return digits || '';
}

function skuKeys(code) {
  const raw = String(code || '').trim();
  const keys = new Set();
  if (!raw) return keys;
  keys.add(`s:${fold(raw)}`);
  const full = digitsKey(raw);
  if (full) keys.add(`d:${full}`);
  // "17800-01" → artículo "17800" (en Tango el código de artículo va sin el sufijo)
  const base = raw.split(/[-\s/]/)[0];
  const baseDigits = digitsKey(base);
  if (baseDigits && baseDigits !== full) keys.add(`d:${baseDigits}`);
  return keys;
}

function normSize(value) {
  return String(value || '').trim().toUpperCase();
}

async function fetchItems() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/catalog-stock`, {
      headers: { 'x-api-key': API_KEY, Accept: 'application/json' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`LupoHub respondió ${res.status}`);
    const json = await res.json();
    return Array.isArray(json?.items) ? json.items : [];
  } finally {
    clearTimeout(timer);
  }
}

/** Filas de LupoHub, cacheadas unos segundos. Si LupoHub falla se usa la última copia buena. */
async function getLupohubItems() {
  if (!USE_LUPOHUB) return null;
  if (cache.items && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (!inflight) {
    inflight = fetchItems()
      .then(items => {
        cache = { at: Date.now(), items, error: null };
        return items;
      })
      .catch(err => {
        console.warn('No se pudo leer el stock de LupoHub:', err.message);
        cache = { ...cache, error: err.message };
        return cache.items;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Índice: clave de artículo → filas de LupoHub. */
function indexItems(items) {
  const bySku = new Map();
  for (const item of items || []) {
    for (const key of skuKeys(item.sku)) {
      if (!bySku.has(key)) bySku.set(key, []);
      bySku.get(key).push(item);
    }
  }
  return bySku;
}

function rowsForProduct(index, code) {
  // Primero coincidencia exacta del código, después por dígitos completos, después por artículo base.
  const keys = [...skuKeys(code)];
  for (const key of keys) {
    const rows = index.get(key);
    if (rows && rows.length) return rows;
  }
  return null;
}

function matchColor(colors, row) {
  const rowCode = fold(row.colorCode);
  const rowName = fold(row.colorName);
  for (const c of colors) {
    if (rowCode && fold(c.code) === rowCode) return c.code;
  }
  for (const c of colors) {
    if (rowName && fold(c.name) === rowName) return c.code;
  }
  if (rowName) {
    for (const c of colors) {
      const name = fold(c.name);
      if (name && (name.startsWith(rowName) || rowName.startsWith(name))) return c.code;
    }
  }
  return colors.length === 1 ? colors[0].code : null;
}

/**
 * Arma { "TALLE|COLOR": cantidad } para un producto del catálogo, o null si LupoHub no lo tiene.
 * colors: [{ code, name }] del catálogo.
 */
function stockMapFor(index, code, colors) {
  const rows = rowsForProduct(index, code);
  if (!rows) return null;
  const map = {};
  for (const row of rows) {
    const colorCode = matchColor(colors || [], row);
    const size = normSize(row.size);
    if (!colorCode || !size) continue;
    const key = `${size}|${colorCode}`;
    map[key] = (map[key] || 0) + Math.max(0, Number(row.stock) || 0);
  }
  return Object.keys(map).length ? map : null;
}

function lupohubStatus() {
  return {
    enabled: USE_LUPOHUB,
    lastSyncAt: cache.at ? new Date(cache.at).toISOString() : null,
    rows: Array.isArray(cache.items) ? cache.items.length : 0,
    error: cache.error
  };
}

module.exports = {
  USE_LUPOHUB,
  getLupohubItems,
  indexItems,
  stockMapFor,
  lupohubStatus,
  normSize
};
