/**
 * Base de datos Postgres (Neon / Vercel Postgres / Supabase / cualquier Postgres).
 * Se activa con DATABASE_URL (o POSTGRES_URL, que es la que crea Vercel/Neon).
 *
 * Tablas:
 *   app_kv        configuración general (whatsapp, etiquetas, productos publicados, secreto de sesión)
 *   price_lists   listas de precios
 *   prices        precio de cada producto en cada lista
 *   users         usuarios (admin y clientes)
 *   product_meta  ajustes por producto (nombre, foto, stock, etiqueta, colores…)
 *
 * El servidor trabaja con el mismo objeto `db` de siempre; este módulo lo lee
 * desde las tablas y lo guarda en una transacción.
 */
/**
 * Railway da un DATABASE_URL con host interno (postgres.railway.internal:5432) que solo
 * funciona dentro de Railway. Desde Vercel hay que usar el proxy público: con
 * DATABASE_PUBLIC_HOST="host:puerto" se reemplaza solo el host y el puerto, y el usuario
 * y la contraseña quedan como están en DATABASE_URL.
 */
function resolveDatabaseUrl(raw, publicHost) {
  const url = String(raw || '').trim();
  const target = String(publicHost || '').trim();
  if (!url || !target) return url;
  try {
    const parsed = new URL(url);
    if (!/\.railway\.internal$/i.test(parsed.hostname)) return url;
    const [host, port] = target.split(':');
    parsed.hostname = host;
    if (port) parsed.port = port;
    return parsed.toString();
  } catch {
    return url;
  }
}

const DATABASE_URL = resolveDatabaseUrl(
  process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  process.env.DATABASE_PUBLIC_HOST
);
const USE_PG = Boolean(DATABASE_URL);

let pool = null;
let schemaReady = null;

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(DATABASE_URL);
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: local || /sslmode=disable/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000
    });
  }
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS price_lists (
  id text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prices (
  list_id text NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  price numeric(14,2) NOT NULL,
  PRIMARY KEY (list_id, product_id)
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL,
  name text,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'cliente',
  price_list_id text,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE TABLE IF NOT EXISTS product_meta (
  product_id text PRIMARY KEY,
  meta jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const USER_COLUMNS = new Set(['id', 'username', 'name', 'passwordHash', 'role', 'priceListId', 'discountPercent']);
const KV_KEYS = ['settings', 'customLabels', 'publishedIds', 'sessionSecret'];

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(SCHEMA).catch(err => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Devuelve el objeto db, o null si la base está vacía (primera vez). */
async function fetchPgDb() {
  await ensureSchema();
  const client = getPool();
  const [kv, lists, prices, users, meta] = await Promise.all([
    client.query('SELECT key, value FROM app_kv'),
    client.query('SELECT id, name FROM price_lists ORDER BY position, id'),
    client.query('SELECT list_id, product_id, price FROM prices'),
    client.query('SELECT * FROM users ORDER BY position, id'),
    client.query('SELECT product_id, meta FROM product_meta')
  ]);
  if (!kv.rowCount && !users.rowCount && !lists.rowCount) return null;

  const data = {};
  for (const row of kv.rows) data[row.key] = row.value;
  const byList = new Map();
  data.priceLists = lists.rows.map(row => {
    const list = { id: row.id, name: row.name, prices: {} };
    byList.set(row.id, list);
    return list;
  });
  for (const row of prices.rows) {
    const list = byList.get(row.list_id);
    if (list) list.prices[row.product_id] = Number(row.price);
  }
  data.users = users.rows.map(row => ({
    ...(row.extra || {}),
    id: row.id,
    username: row.username,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role,
    priceListId: row.price_list_id,
    discountPercent: Number(row.discount_percent) || 0
  }));
  data.productMeta = {};
  for (const row of meta.rows) data.productMeta[row.product_id] = row.meta;
  return data;
}

function userExtra(user) {
  const extra = {};
  for (const [k, v] of Object.entries(user || {})) {
    if (!USER_COLUMNS.has(k)) extra[k] = v;
  }
  return extra;
}

/** Guarda el objeto db completo en una sola transacción. */
async function savePgDb(data) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const key of KV_KEYS) {
      if (data[key] === undefined) continue;
      await client.query(
        `INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         WHERE app_kv.value IS DISTINCT FROM EXCLUDED.value`,
        [key, JSON.stringify(data[key])]
      );
    }

    const lists = (data.priceLists || []).map((l, i) => ({ id: l.id, name: l.name || l.id, position: i }));
    await client.query(
      `INSERT INTO price_lists (id, name, position)
       SELECT id, name, position FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, position int)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position, updated_at = now()
       WHERE price_lists.name IS DISTINCT FROM EXCLUDED.name OR price_lists.position IS DISTINCT FROM EXCLUDED.position`,
      [JSON.stringify(lists)]
    );
    await client.query('DELETE FROM price_lists WHERE NOT (id = ANY($1::text[]))', [lists.map(l => l.id)]);

    const priceRows = [];
    for (const list of data.priceLists || []) {
      for (const [productId, price] of Object.entries(list.prices || {})) {
        if (Number.isFinite(price)) priceRows.push({ list_id: list.id, product_id: productId, price });
      }
    }
    await client.query(
      `INSERT INTO prices (list_id, product_id, price)
       SELECT list_id, product_id, price FROM jsonb_to_recordset($1::jsonb) AS x(list_id text, product_id text, price numeric)
       ON CONFLICT (list_id, product_id) DO UPDATE SET price = EXCLUDED.price
       WHERE prices.price IS DISTINCT FROM EXCLUDED.price`,
      [JSON.stringify(priceRows)]
    );
    await client.query(
      `DELETE FROM prices p WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS x(list_id text, product_id text)
         WHERE x.list_id = p.list_id AND x.product_id = p.product_id)`,
      [JSON.stringify(priceRows.map(({ list_id, product_id }) => ({ list_id, product_id })))]
    );

    const users = (data.users || []).map((u, i) => ({
      id: u.id,
      username: u.username,
      name: u.name || null,
      password_hash: u.passwordHash,
      role: u.role || 'cliente',
      price_list_id: u.priceListId || null,
      discount_percent: Number(u.discountPercent) || 0,
      extra: userExtra(u),
      position: i
    }));
    const userIds = users.map(u => u.id);
    await client.query('DELETE FROM users WHERE NOT (id = ANY($1::text[]))', [userIds]);
    await client.query(
      `INSERT INTO users (id, username, name, password_hash, role, price_list_id, discount_percent, extra, position)
       SELECT id, username, name, password_hash, role, price_list_id, discount_percent, extra, position
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, username text, name text, password_hash text, role text,
         price_list_id text, discount_percent numeric, extra jsonb, position int)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, price_list_id = EXCLUDED.price_list_id,
         discount_percent = EXCLUDED.discount_percent, extra = EXCLUDED.extra, position = EXCLUDED.position,
         updated_at = now()
       WHERE (users.username, users.name, users.password_hash, users.role, users.price_list_id,
              users.discount_percent, users.extra, users.position)
         IS DISTINCT FROM (EXCLUDED.username, EXCLUDED.name, EXCLUDED.password_hash, EXCLUDED.role,
              EXCLUDED.price_list_id, EXCLUDED.discount_percent, EXCLUDED.extra, EXCLUDED.position)`,
      [JSON.stringify(users)]
    );

    const metaRows = Object.entries(data.productMeta || {}).map(([product_id, meta]) => ({ product_id, meta }));
    await client.query(
      `INSERT INTO product_meta (product_id, meta)
       SELECT product_id, meta FROM jsonb_to_recordset($1::jsonb) AS x(product_id text, meta jsonb)
       ON CONFLICT (product_id) DO UPDATE SET meta = EXCLUDED.meta, updated_at = now()
       WHERE product_meta.meta IS DISTINCT FROM EXCLUDED.meta`,
      [JSON.stringify(metaRows)]
    );
    await client.query('DELETE FROM product_meta WHERE NOT (product_id = ANY($1::text[]))', [metaRows.map(r => r.product_id)]);

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function closePg() {
  if (pool) await pool.end();
  pool = null;
  schemaReady = null;
}

module.exports = {
  USE_PG,
  resolveDatabaseUrl,
  fetchPgDb,
  savePgDb,
  closePg
};
