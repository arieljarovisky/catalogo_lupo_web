# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios en pesos y panel de administración, con estilo inspirado en [multilupo.com.ar](https://www.multilupo.com.ar).

## Cómo iniciarlo

En la carpeta del proyecto:

```
npm install
npm start
```

Después abrí [http://localhost:3000](http://localhost:3000).

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

## Vercel

El frontend se sirve estático. El login y las APIs (`/api/...`) van por `server.js` a través de `api/index.js`.

En el proyecto de Vercel, agregá:

- `SESSION_SECRET`: texto largo y aleatorio (sin eso las sesiones pueden invalidarse entre deploys).
- `BLOB_READ_WRITE_TOKEN`: creá un store en **Storage → Blob** y conectalo al proyecto. Sin esto, cambiar fotos en Admin falla en producción (el disco de la función es efímero).

En Vercel el `db.json` vive en `/tmp`: usuarios, precios y overrides de imagen editados en Admin **no persisten** entre cold starts. Para producción hace falta una base externa; las URLs de Blob sí quedan públicas, pero la referencia en `productMeta` se pierde si el `db.json` se reinicia.
