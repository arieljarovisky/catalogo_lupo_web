const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LupoCatalog/1.0)' }
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function productLinks(html) {
  const links = new Set();
  const re = /href="(https:\/\/multilupo\.com\.ar\/productos\/[a-z0-9-]+\/)"/gi;
  let m;
  while ((m = re.exec(html))) links.add(m[1].split('?')[0]);
  return [...links];
}

function absUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return '';
}

function norm(code) {
  return String(code || '')
    .toLowerCase()
    .replace(/^0+/, '')
    .replace(/-0+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function keysFrom(code, url, name, sku) {
  const keys = new Set();
  const add = v => { const n = norm(v); if (n) keys.add(n); };
  add(code);
  if (code && code.includes('-')) add(code.split('-')[0]);
  const slug = (url || '').split('/productos/')[1] || '';
  for (const m of slug.matchAll(/(\d{3,5}(?:-\d{2,3})?)/g)) add(m[1]);
  for (const m of String(name || '').matchAll(/(\d{3,5}(?:-\d{2,3})?)/g)) add(m[1]);
  if (sku) {
    add(sku);
    const m5 = String(sku).match(/^0*(\d{3,5})/);
    if (m5) add(m5[1]);
  }
  return [...keys];
}

function parseStoreProduct(html, url) {
  const variantsMatch = html.match(/LS\.variants\s*=\s*(\[[\s\S]*?\]);/);
  const variants = variantsMatch ? JSON.parse(variantsMatch[1]) : [];
  const name = (html.match(/class="js-product-name[^"]*"[^>]*>([^<]+)/i) || [])[1] || '';
  let image = '';
  let sku = '';
  const colors = new Map();
  for (const v of variants) {
    const img = absUrl(v.image_url);
    if (!image && img) image = img;
    if (!sku && v.sku) sku = v.sku;
    const colorName = String(v.option1 || '').trim();
    if (colorName && img) {
      const key = normName(colorName);
      if (key && !colors.has(key)) colors.set(key, { name: colorName, image: img });
    }
  }
  if (!image) {
    const og = html.match(/property="og:image"\s+content="([^"]+)"/i);
    if (og) image = absUrl(og[1]) || og[1];
  }
  return {
    url,
    name: name.trim(),
    image,
    sku,
    keys: keysFrom('', url, name, sku),
    colors: [...colors.values()]
  };
}

function bestMatch(product, storeItems) {
  const want = keysFrom(product.code, '', product.name, '');
  let best = null;
  let bestScore = 0;
  for (const item of storeItems) {
    if (!item.image && !item.colors.length) continue;
    let score = 0;
    for (const k of want) {
      if (item.keys.includes(k)) score = Math.max(score, k.length);
    }
    const pBase = norm(product.code.split('-')[0]);
    if (item.keys.includes(pBase)) score = Math.max(score, pBase.length);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 3 ? best : null;
}

function colorScore(catalogName, storeName) {
  const a = normName(catalogName);
  const b = normName(storeName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 50 + Math.min(a.length, b.length);
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = b.split(' ').filter(Boolean);
  const hit = bt.filter(t => at.has(t) && t.length >= 4).length;
  return hit ? 20 + hit * 10 : 0;
}

function assignColorImages(product, storeItem) {
  if (!storeItem?.colors?.length || !product.colors?.length) return 0;
  let n = 0;
  const used = new Set();
  for (const color of product.colors) {
    let best = null;
    let bestScore = 0;
    storeItem.colors.forEach((storeColor, idx) => {
      if (used.has(idx)) return;
      const score = colorScore(color.name, storeColor.name);
      if (score > bestScore) {
        bestScore = score;
        best = { idx, image: storeColor.image };
      }
    });
    if (best && bestScore >= 20) {
      color.image = best.image;
      used.add(best.idx);
      n += 1;
    }
  }
  return n;
}

async function main() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), ctx);
  const products = ctx.window.PRODUCTS;

  const urls = new Set();
  for (let page = 1; page <= 20; page++) {
    const listUrl = page === 1
      ? 'https://multilupo.com.ar/productos/'
      : `https://multilupo.com.ar/productos/page/${page}/`;
    const html = await get(listUrl);
    const found = productLinks(html);
    const before = urls.size;
    found.forEach(u => urls.add(u));
    if (urls.size === before) break;
  }
  console.log('store urls', urls.size);

  const storeItems = [];
  let i = 0;
  for (const url of urls) {
    i += 1;
    process.stdout.write(`store ${i}/${urls.size}\n`);
    try {
      storeItems.push(parseStoreProduct(await get(url), url));
    } catch (err) {
      console.error('fail', url, err.message);
    }
    await new Promise(r => setTimeout(r, 80));
  }

  let matched = 0;
  let colorHits = 0;
  const missing = [];
  for (const p of products) {
    const hit = bestMatch(p, storeItems);
    if (hit) {
      if (hit.image) p.image = hit.image;
      colorHits += assignColorImages(p, hit);
      matched += 1;
    } else {
      missing.push(`${p.code} ${p.name}`);
    }
  }

  fs.writeFileSync(path.join(__dirname, 'data.js'), `window.PRODUCTS = ${JSON.stringify(products)};\n`, 'utf8');
  console.log('matched products', matched, '/', products.length);
  console.log('color photos from store', colorHits);
  if (missing.length) {
    console.log('sin ficha web:');
    missing.forEach(x => console.log(' -', x));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
