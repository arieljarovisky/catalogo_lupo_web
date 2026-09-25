# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios en pesos y panel de administración, con estilo inspirado en [multilupo.com.ar](https://www.multilupo.com.ar).

## Cómo iniciarlo

En la carpeta del proyecto:

```
npm install
npm start
```

Después abrí [http://localhost:3000](http://localhost:3000).

La persistencia es el archivo `db.json` (usuarios, listas, precios, publicados) y las fotos en `assets/uploads/`.

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`

Cambiá estas claves desde el panel de usuarios.

## Qué incluye

- Login por usuario.
- Cada cliente ve solo los productos publicados y el precio de **su lista**, con descuento % opcional por cliente.
- Si un producto no tiene precio en esa lista, se muestra **Consultar**.
- Panel admin: publicar/ocultar productos, crear y editar listas de precios en ARS, alta de usuarios y asignación de lista.
- Pedido con talle, color y cantidad, exportable a Excel con precios en pesos.

Los datos de ficha se extraen de los PDF en `pdfs/nuevos-catalogos/` (Boxers y slips, Lencería y Medias 2026).

## Producción (Vercel)

El deploy incluye `db.json`. Los cambios hechos desde el admin en Vercel viven en `/tmp` (mientras dure la instancia). Para dejarlos fijos: actualizá `db.json` en el repo y redeployá.

Variable opcional en Vercel:

| Variable | Uso |
|---|---|
| `SESSION_SECRET` | texto largo y aleatorio |
