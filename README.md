# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios y panel de administración.

## Cómo iniciarlo

```
npm install
npm start
```

Abrí [http://localhost:3000](http://localhost:3000).

En local persiste en `db.json`.

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`

## Persistencia en Vercel (sin Supabase)

Vercel no guarda archivos entre reinicios. El estado (`db.json`: usuarios, listas, precios) se guarda en la rama **`data`** del mismo repo de GitHub.

### 1. Crear un token de GitHub

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Repository: `catalogo_lupo_web`
3. Permissions → **Contents: Read and write**
4. Generá el token

### 2. Variables en Vercel

| Variable | Valor |
|---|---|
| `GITHUB_TOKEN` | el token |
| `GITHUB_REPO` | `arieljarovisky/catalogo_lupo_web` |
| `GITHUB_BRANCH` | `data` (default) |
| `SESSION_SECRET` | texto largo aleatorio |

Después del deploy, `/api/health` debe responder `"persistencia":"github"`.
