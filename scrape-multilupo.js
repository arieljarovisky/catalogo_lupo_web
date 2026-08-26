const fs = require('fs');
const path = require('path');

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

function extractCode(url, name, sku) {
  const slug = url.split('/productos/')[1].replace(/\/$/, '');
  const fromSlug = slug.match(/(\d{3,5}(?:-\d{2,3})?)(?:-|$)/);
  if (fromSlug) return fromSlug[1];
  const fromName = (name || '').match(/(\d{3,5}(?:-\d{2,3})?)/);
  if (fromName) return fromName[1];
  return sku || slug;
}

function parseProduct(html, url) {
  const variantsMatch = html.match(/LS\.variants\s*=\s*(\[[\s\S]*?\]);/);
  const variants = variantsMatch ? JSON.parse(variantsMatch[1]) : [];
  const name = (html.match(/class="js-product-name[^"]*"[^>]*>([^<]+)/i) || [])[1]
    || (html.match(/<h1[^>]*>([^<]+)/i) || [])[1]
    || 'Producto Lupo';
  const desc = (html.match(/itemprop="description"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]
    || (html.match(/<meta name="description" content="([^"]+)"/i) || [])[1]
    || '';
  const crumbs = [...html.matchAll(/itemprop="name">([^<]+)/gi)].map(x => x[1].trim());
  const catalog = crumbs.find(c => ['Damas', 'Hombre', 'Medias', 'Pijamas'].includes(c)) || 'Productos';
  const category = crumbs.filter(c => !['Inicio', 'Lupo', name.trim()].includes(c)).slice(-1)[0] || catalog;
  const colorsMap = new Map();
  const sizes = [];
  let image = '';
  let sku = '';
  let priceArs = null;
  for (const v of variants) {
    if (v.option1) {
      const key = String(v.option1).toLowerCase();
      if (!colorsMap.has(key)) colorsMap.set(key, { code: (v.sku || '').slice(-4) || key.slice(0, 4), name: v.option1 });
    }
    if (v.option0 && !sizes.includes(v.option0)) sizes.push(v.option0);
    if (!image && v.image_url) image = v.image_url.startsWith('http') ? v.image_url : `https:${v.image_url}`;
    if (!sku && v.sku) sku = v.sku;
    if (priceArs == null && Number.isFinite(v.price_number)) priceArs = v.price_number;
  }
  const cleanDesc = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const code = extractCode(url, name, sku);
  const id = `ml-${code}-${variants[0]?.product_id || Buffer.from(url).toString('hex').slice(0, 8)}`;
  return {
    product: {
      id,
      code,
      name: name.trim(),
      category,
      catalog,
      pdf: url,
      page: 1,
      image,
      colors: [...colorsMap.values()],
      sizes: sizes.join(' • ') || 'Único',
      description: cleanDesc,
      tech: [],
      fobUsd: null
    },
    priceArs
  };
}

async function main() {
  const urls = new Set();
  for (let page = 1; page <= 20; page++) {
    const listUrl = page === 1
      ? 'https://multilupo.com.ar/productos/'
      : `https://multilupo.com.ar/productos/page/${page}/`;
    process.stdout.write(`list ${page}...\n`);
    const html = await get(listUrl);
    const found = productLinks(html);
    const before = urls.size;
    found.forEach(u => urls.add(u));
    if (urls.size === before) break;
  }
  console.log('urls', urls.size);
  const products = [];
  const prices = {};
  let i = 0;
  for (const url of urls) {
    i += 1;
    process.stdout.write(`product ${i}/${urls.size}\n`);
    try {
      const html = await get(url);
      const { product, priceArs } = parseProduct(html, url);
      products.push(product);
      if (priceArs != null) prices[product.id] = priceArs;
    } catch (err) {
      console.error('fail', url, err.message);
    }
    await new Promise(r => setTimeout(r, 120));
  }
  products.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  const outJs = `window.PRODUCTS = ${JSON.stringify(products)};\n`;
  fs.writeFileSync(path.join(__dirname, 'data.js'), outJs, 'utf8');
  fs.writeFileSync(path.join(__dirname, 'multilupo-prices.json'), JSON.stringify(prices, null, 2), 'utf8');
  const byCat = {};
  for (const p of products) byCat[p.catalog] = (byCat[p.catalog] || 0) + 1;
  console.log('saved', products.length, byCat);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
