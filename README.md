# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios en pesos y panel de administración, con estilo inspirado en [multilupo.com.ar](https://www.multilupo.com.ar).

## Cómo iniciarlo

```
npm install
npm start
```

Abrí [http://localhost:3000](http://localhost:3000).

En local usa `db.json` y `assets/uploads/`.

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`

## Qué incluye

- Login por usuario.
- Cada cliente ve los productos publicados y el precio de **su lista**, con descuento % opcional.
- Panel admin: publicar productos, listas de precios, usuarios.
- Pedido con talle/color/cantidad exportable a Excel.

## Persistencia en Vercel (importante)

En Vercel el disco es temporal: **sin Supabase los usuarios y precios se borran** al reiniciar.

Configurá en Vercel:

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` | API Keys → secret (`sb_secret_...`) |
| `SESSION_SECRET` | texto largo aleatorio |

Schema: ejecutá [`supabase/schema.sql`](supabase/schema.sql) en el SQL Editor.

Para subir el `db.json` local a Supabase:

```
npm run migrate:supabase
```
