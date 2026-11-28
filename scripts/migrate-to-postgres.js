/**
 * Copia la base actual (db.json de la rama `data` si hay GITHUB_TOKEN, si no el db.json local)
 * a Postgres. Uso:
 *   DATABASE_URL=postgres://... node scripts/migrate-to-postgres.js [--force]
 * Sin --force no pisa una base Postgres que ya tenga datos.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { USE_PG, fetchPgDb, savePgDb, closePg } = require('../lib/db-postgres');
const { USE_REMOTE_DB, fetchRemoteDb } = require('../lib/db-remote');

async function main() {
  if (!USE_PG) throw new Error('Falta DATABASE_URL (o POSTGRES_URL).');
  const force = process.argv.includes('--force');
  const existing = await fetchPgDb();
  if (existing && !force) {
    console.log(`Postgres ya tiene datos (${existing.users.length} usuarios). Usá --force para pisarlos.`);
    return;
  }
  let source = null;
  let from = '';
  if (USE_REMOTE_DB) {
    source = await fetchRemoteDb();
    from = 'db.json remoto (rama data)';
  }
  if (!source) {
    source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db.json'), 'utf8'));
    from = 'db.json local';
  }
  await savePgDb(source);
  const check = await fetchPgDb();
  const prices = check.priceLists.reduce((n, l) => n + Object.keys(l.prices).length, 0);
  console.log(`Migrado desde ${from}: ${check.users.length} usuarios, ${check.priceLists.length} listas, ${prices} precios, ${Object.keys(check.productMeta).length} productos con ajustes.`);
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => closePg());
