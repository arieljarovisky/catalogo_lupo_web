# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios en pesos y panel de administración, con estilo inspirado en [multilupo.com.ar](https://www.multilupo.com.ar).

## Cómo iniciarlo

En la carpeta del proyecto:

```
npm install
npm start
```

Después abrí [http://localhost:3000](http://localhost:3000).

Sin variables de Supabase, en local usa `db.json` y `assets/uploads/`.

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`

Cambiá estas claves desde el panel de usuarios.

## Qué incluye

- Login por usuario.
- Cada cliente ve solo los productos publicados y el precio de **su lista**.
- Si un producto no tiene precio en esa lista, se muestra **Consultar**.
- Panel admin: publicar/ocultar productos, crear y editar listas de precios en ARS, alta de usuarios y asignación de lista.
- Pedido con talle, color y cantidad, exportable a Excel con precios en pesos.

Los datos de ficha se extraen de los PDF en `pdfs/nuevos-catalogos/` (Boxers y slips, Lencería y Medias 2026).

## Supabase (producción)

En Vercel hace falta Supabase para que usuarios, precios, fotos y pedidos **persistan**.

### 1. Crear el schema

En Supabase → **SQL Editor**, ejecutá el contenido de [`supabase/schema.sql`](supabase/schema.sql).

Eso crea:

- tabla `app_state` (estado del catálogo, equivalente a `db.json`)
- tabla `orders` (excels de pedidos)
- bucket público `uploads` (fotos custom)

### 2. Variables de entorno

En Vercel (y opcionalmente en local):

| Variable | Dónde |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` | API Keys → secret (`sb_secret_...`) — solo backend |
| `SESSION_SECRET` | texto largo y aleatorio |

También acepta el nombre legacy `SUPABASE_SERVICE_ROLE_KEY` (JWT `eyJ...`).

Nunca expongas la secret key en el frontend.

### 3. Migrar el `db.json` actual

```
SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run migrate:supabase
```

### 4. Redeploy

Después del deploy, cambiar fotos, precios y usuarios queda guardado en Supabase.
