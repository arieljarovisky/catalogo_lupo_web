# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios y panel de administración.

## Cómo iniciarlo

```
npm install
npm start
```

Abrí [http://localhost:3000](http://localhost:3000).

## Persistencia

Todo el estado (usuarios, listas, precios, publicados) está en **`db.json`** en la raíz del proyecto.

- En **local**, el admin guarda directo en ese archivo.
- En **Vercel**, el archivo del deploy es el que vale: para cambiar usuarios/precios de forma definitiva, editá en local, guardá, y hacé `git push` (redeploy).

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`
