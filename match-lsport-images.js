#!/usr/bin/env node
/**
 * Matches per-color images from lsport.com.br / lupo.com.br (VTEX) into data.js.
 * Also can add missing Sport SKUs found on LSport (see EXTRA_CODES).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data.js');
const HOSTS = ['www.lsport.com.br', 'www.lupo.com.br'];
const EXTRA_SKUS = [
  { code: '77230-001', name: 'T-shirt LSport AirDry Masculina' },
  { code: '77226-001', name: 'T-shirt LSport AirDry Feminina' },
  { code: '40335-01', name: 'VEDETINA LESS ALG' }
];

function normCode(code) {
  return String(code || '').trim().toUpperCase().replace(/^0+/, '').replace(/[^A-Z0-9]/g, '');
}

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function searchVtex(host, query) {
  const url = `https://${host}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=8`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LupoCatalog/1.0)' } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function searchAll(queries) {
  const seen = new Set();
  const out = [];
  for (const host of HOSTS) {
    for (const q of queries) {
      if (!q) continue;
      try {
        const results = await searchVtex(host, q);
        for (const p of results) {
          const key = `${p.productId || ''}|${p.productReference || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(p);
        }
        // If we already have a strong code match, stop early.
        if (out.length && host === HOSTS[0]) {
          const strong = out.some(p => queries.some(q => normCode(p.productReference) === normCode(q)));
          if (strong) return out;
        }
      } catch {
        // ignore host errors
      }
      await new Promise(r => setTimeout(r, 50));
    }
    if (out.length) return out; // prefer lsport hits before querying lupo.com.br
  }
  return out;
}

function extractColorMap(vtexProduct) {
  const map = new Map();
  let firstImage = '';
  for (const item of vtexProduct.items || []) {
    const imgs = item.images || [];
    const image = imgs[0]?.imageUrl || '';
    if (!image) continue;
    if (!firstImage) firstImage = image;
    const fileMatch = image.match(/\/(\d{4,5}-\d{2,3})-(\d{3,4})-\d+\./i);
    const colorCode = fileMatch ? fileMatch[2] : '';
    const nameMatch = String(item.name || '').match(/Cor:\s*([^|]+)/i);
    const colorName = nameMatch ? nameMatch[1].trim() : '';
    if (colorCode && !map.has(`code:${colorCode}`)) map.set(`code:${colorCode}`, image);
    if (colorCode && !map.has(`code:${colorCode.replace(/^0+/, '')}`)) {
      map.set(`code:${colorCode.replace(/^0+/, '')}`, image);
    }
    if (colorName && !map.has(`name:${normName(colorName)}`)) map.set(`name:${normName(colorName)}`, image);
  }
  map.firstImage = firstImage;
  return map;
}

function pickVtexProduct(results, catalogCode, catalogName) {
  const want = normCode(catalogCode);
  const wantName = normName(catalogName);
  let best = null;
  let bestScore = 0;
  for (const p of results) {
    const ref = normCode(p.productReference || '');
    const pname = normName(p.productName || '');
    let score = 0;
    if (ref === want) score = 100;
    else if (want && (ref.startsWith(want) || want.startsWith(ref))) score = 80;
    else if (want && JSON.stringify(p).toUpperCase().includes(String(catalogCode).toUpperCase())) score = 50;
    if (wantName && pname === wantName) score = Math.max(score, 90);
    else if (wantName && wantName.length > 8 && (pname.includes(wantName) || wantName.includes(pname))) {
      score = Math.max(score, 70);
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 50 ? best : null;
}

function assignImages(product, colorMap) {
  let n = 0;
  for (const color of product.colors || []) {
    if (color.image) continue;
    const raw = String(color.code || '');
    const byCode = colorMap.get(`code:${raw.replace(/^0+/, '')}`)
      || colorMap.get(`code:${raw}`);
    const byName = colorMap.get(`name:${normName(color.name)}`);
    const image = byCode || byName || '';
    if (image) {
      color.image = image;
      n += 1;
    }
  }
  if (!product.image && colorMap.firstImage) product.image = colorMap.firstImage;
  return n;
}

function colorsFromVtex(vtexProduct) {
  const byCode = new Map();
  for (const item of vtexProduct.items || []) {
    const imgs = item.images || [];
    const image = imgs[0]?.imageUrl || '';
    const fileMatch = (image || '').match(/\/(\d{4,5}-\d{2,3})-(\d{3,4})-\d+\./i);
    const colorCode = fileMatch ? fileMatch[2] : '';
    const nameMatch = String(item.name || '').match(/Cor:\s*([^|]+)/i);
    const colorName = nameMatch ? nameMatch[1].trim() : '';
    if (!colorCode || byCode.has(colorCode)) continue;
    byCode.set(colorCode, { code: colorCode, name: colorName || colorCode, image });
  }
  return [...byCode.values()];
}

function sizesFromVtex(vtexProduct) {
  const sizes = [];
  for (const item of vtexProduct.items || []) {
    const m = String(item.name || '').match(/Tamanho:\s*([^|]+)/i);
    const size = m ? m[1].trim().split(/\s+/)[0] : '';
    if (size && !sizes.includes(size)) sizes.push(size);
  }
  return sizes.length ? sizes.join(' · ') : 'P · M · G · GG';
}

async function main() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), ctx);
  const products = ctx.window.PRODUCTS;
  const byCode = new Map(products.map(p => [normCode(p.code), p]));

  let updatedProducts = 0;
  let updatedColors = 0;
  let checked = 0;
  let added = 0;

  const needsImages = products.filter(p => (p.colors || []).some(c => !c.image));
  const sportFirst = (p) => /sport/i.test(p.catalog || '') || /lupo-sport|lsport/i.test(p.image || '') || /lsport/i.test(p.id || '');
  const targets = [
    ...needsImages.filter(sportFirst),
    ...needsImages.filter(p => !sportFirst(p))
  ];
  for (const product of targets) {
    checked += 1;
    process.stdout.write(`\rcheck ${checked}/${targets.length} ${product.code}          `);
    const queries = [
      product.code,
      String(product.code || '').split('-')[0],
      product.name
    ].filter(Boolean);
    const results = await searchAll(queries);
    const match = pickVtexProduct(results, product.code, product.name);
    if (!match) continue;
    const map = extractColorMap(match);
    const n = assignImages(product, map);
    if (n) {
      updatedProducts += 1;
      updatedColors += n;
    }
  }

  for (const extra of EXTRA_SKUS) {
    if (byCode.has(normCode(extra.code))) continue;
    process.stdout.write(`\radd ${extra.code}          `);
    const results = await searchAll([
      extra.code,
      String(extra.code).split('-')[0],
      extra.name,
      extra.name.replace(/LSport/i, '').trim()
    ]);
    let match = pickVtexProduct(results, extra.code, extra.name)
      || results.find(p => normCode(p.productReference) === normCode(extra.code))
      || null;
    if (!match) continue;
    const colors = colorsFromVtex(match);
    const map = extractColorMap(match);
    const id = `lsport-${normCode(extra.code).toLowerCase()}`;
    const product = {
      id,
      code: match.productReference || extra.code,
      name: match.productName || extra.name || extra.code,
      category: 'LSport',
      catalog: 'Lupo Sport Varejo PV 27',
      description: '',
      tech: [],
      sizes: sizesFromVtex(match),
      colors,
      image: map.firstImage || colors[0]?.image || '',
      pdf: null,
      page: null,
      fobUsd: null
    };
    products.push(product);
    byCode.set(normCode(product.code), product);
    added += 1;
    updatedProducts += 1;
    updatedColors += colors.filter(c => c.image).length;
  }

  fs.writeFileSync(DATA, `window.PRODUCTS = ${JSON.stringify(products)};\n`);
  console.log(`\nDone. products touched: ${updatedProducts}, colors updated: ${updatedColors}, added SKUs: ${added}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
