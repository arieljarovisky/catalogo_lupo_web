#!/usr/bin/env node
/**
 * Sube el db.json local a Supabase (tabla app_state).
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/migrate-to-supabase.js
 */
const fs = require('fs');
const path = require('path');
const { USE_SUPABASE, upsertAppState } = require('../lib/supabase');

async function main() {
  if (!USE_SUPABASE) {
    console.error('Definí SUPABASE_URL y SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }
  const dbPath = path.join(__dirname, '..', 'db.json');
  if (!fs.existsSync(dbPath)) {
    console.error('No existe db.json en la raíz del proyecto.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  await upsertAppState(data);
  console.log('OK: db.json migrado a app_state (id=main).');
  console.log(`Usuarios: ${(data.users || []).length}, listas: ${(data.priceLists || []).length}, publicados: ${(data.publishedIds || []).length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
