# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios y panel de administración.

## Cómo iniciarlo

```
npm install
npm start
```

## Base de datos: Postgres

La app guarda usuarios, listas de precios, ajustes de productos y configuración en **Postgres**
cuando existe la variable `DATABASE_URL` (o `POSTGRES_URL`, la que crea Vercel).

Tablas (se crean solas al arrancar): `users`, `price_lists`, `prices`, `product_meta`, `app_kv`.

### Configurarla en Vercel (gratis con Neon)

1. Vercel → proyecto → **Storage** → **Create Database** → **Neon (Postgres)** → plan Free → conectar al proyecto.
   Eso agrega `DATABASE_URL`/`POSTGRES_URL` a las variables de entorno.
2. Redeploy. En el primer arranque, si la base está vacía, se copia sola desde el `db.json`
   de la rama `data` (si sigue estando `GITHUB_TOKEN`) o desde el `db.json` del repo.
3. Verificá en `/api/health` que diga `"persistencia": "postgres"`.

Migración manual (opcional): `DATABASE_URL=... node scripts/migrate-to-postgres.js` (`--force` para pisar).

Sin `DATABASE_URL` todo sigue funcionando como antes (db.json local o en la rama `data` con `GITHUB_TOKEN`).

## Catálogo público, precios con usuario

- `/` lo ve cualquiera, sin login. Los visitantes ven productos, fotos, talles y colores, pero **no precios**
  (el servidor no los manda) y no pueden armar pedidos.
- Para ver precios, el cliente pide acceso por WhatsApp (botón "Pedir acceso") y el admin le crea un usuario
  en `/admin` con su lista de precios.
- `/admin` y `/brasil` siguen siendo solo para administradores.

## Dominio: catalogo.lupo.ar

1. Vercel → proyecto → **Settings → Domains** → agregar `catalogo.lupo.ar`.
2. En el DNS de lupo.ar, crear un registro `CNAME` `catalogo` → `cname.vercel-dns.com` (o el valor que muestre Vercel).
3. Variable de entorno `PUBLIC_BASE_URL=https://catalogo.lupo.ar` para que los links de pedidos usen ese dominio.

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`
