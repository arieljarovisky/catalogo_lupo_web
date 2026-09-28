# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios y panel de administración.

## Cómo iniciarlo

```
npm install
npm start
```

## Una sola base: `db.json`

Local y producción usan el **mismo** `db.json`.

- **Local (sin token):** lee/escribe el archivo `db.json` del disco.
- **Producción (Vercel):** necesita `GITHUB_TOKEN` para leer/escribir ese mismo `db.json` en la rama `data` del repo (así los usuarios no se borran).

### Variable obligatoria en Vercel

1. Creá un Fine-grained token: [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
   - Repo: `catalogo_lupo_web`
   - Contents: **Read and write**
2. En Vercel → Settings → Environment Variables:
   - `GITHUB_TOKEN` = el token
   - `GITHUB_REPO` = `arieljarovisky/catalogo_lupo_web`
   - `GITHUB_BRANCH` = `data`

Sin eso, el sitio abre pero **el admin no puede guardar** en producción.

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`
