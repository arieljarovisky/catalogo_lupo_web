# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios y panel de administración.

## Cómo iniciarlo

```
npm install
npm start
```

## Una sola base: `db.json`

Local y producción usan el **mismo** `db.json`. **No se versiona en `main`** (está en `.gitignore`): vive solo en la rama `data` y, en local, como archivo propio.

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
   - `SESSION_SECRET` = texto aleatorio de 32+ caracteres (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

Sin `GITHUB_TOKEN` el sitio no puede guardar; sin `SESSION_SECRET` el login queda bloqueado (para que nadie pueda firmar cookies de admin). Si GitHub no responde, la app devuelve 503 y reintenta: nunca cae a una base vacía ni pisa la de la rama `data`.

## Primer acceso

No hay usuarios ni claves por defecto. Si la base no tiene ningún usuario, se crea `admin` con la clave de `ADMIN_PASSWORD` (8+ caracteres) o, si no está, con una clave al azar que se muestra **una sola vez** en la consola. Cambiala desde el panel apenas entres.

## Seguridad

- Nunca subas `db.json` ni `.env` a `main`.
- Si el repo es público, la rama `data` también lo es: conviene hacer el repo privado o apuntar `GITHUB_REPO` a un repo privado solo para datos.
