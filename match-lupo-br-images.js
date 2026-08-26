#!/usr/bin/env node
/**
 * Matches per-color images from lupo.com.br (VTEX) into data.js.
 * Only updates colors that currently lack an image.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data.js');

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

async function searchVtex(query) {
  const url = `https://www.lupo.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=5`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LupoCatalog/1.0)' } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function extractColorMap(vtexProduct) {
  const map = new Map(); // colorCode -> imageUrl, and name -> imageUrl
  for (const item of vtexProduct.items || []) {
    const imgs = item.images || [];
    const image = imgs[0]?.imageUrl || '';
    if (!image) continue;
    const fileMatch = image.match(/\/(\d{4,5}-\d{3})-(\d{3,4})-\d+\./i);
    const colorCode = fileMatch ? fileMatch[2] : '';
    const nameMatch = String(item.name || '').match(/Cor:\s*([^|]+)/i);
    const colorName = nameMatch ? nameMatch[1].trim() : '';
    if (colorCode && !map.has(`code:${colorCode}`)) map.set(`code:${colorCode}`, image);
    if (colorName && !map.has(`name:${normName(colorName)}`)) map.set(`name:${normName(colorName)}`, image);
  }
  return map;
}

function pickVtexProduct(results, catalogCode) {
  const want = normCode(catalogCode);
  let best = null;
  let bestScore = 0;
  for (const p of results) {
    const ref = normCode(p.productReference || '');
    let score = 0;
    if (ref === want) score = 100;
    else if (ref.startsWith(want) || want.startsWith(ref)) score = 80;
    else if (JSON.stringify(p).toUpperCase().includes(catalogCode.toUpperCase())) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 40 ? best : null;
}

function assignImages(product, colorMap) {
  let n = 0;
  for (const color of product.colors || []) {
    if (color.image) continue;
    const byCode = colorMap.get(`code:${String(color.code || '').replace(/^0+/, '')}`)
      || colorMap.get(`code:${String(color.code || '')}`);
    const byName = colorMap.get(`name:${normName(color.name)}`);
    const image = byCode || byName || '';
    if (image) {
      color.image = image;
      n += 1;
    }
  }
  return n;
}

async function main() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), ctx);
  const products = ctx.window.PRODUCTS;
  let updatedProducts = 0;
  let updatedColors = 0;
  let checked = 0;

  for (const product of products) {
    const needs = (product.colors || []).filter(c => !c.image);
    if (!needs.length) continue;
    checked += 1;
    process.stdout.write(`\rcheck ${checked} ${product.code}          `);
    try {
      const results = await searchVtex(product.code);
      const match = pickVtexProduct(results, product.code);
      if (!match) {
        await new Promise(r => setTimeout(r, 40));
        continue;
      }
      const map = extractColorMap(match);
      const n = assignImages(product, map);
      if (n) {
        updatedProducts += 1;
        updatedColors += n;
        if (!product.image) {
          const first = [...map.values()][0];
          if (first) product.image = first;
        }
      }
    } catch (err) {
      console.error('\nfail', product.code, err.message);
    }
    await new Promise(r => setTimeout(r, 60));
  }

  fs.writeFileSync(DATA, `window.PRODUCTS = ${JSON.stringify(products)};\n`);
  console.log(`\nDone. products with new color images: ${updatedProducts}, colors updated: ${updatedColors}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
