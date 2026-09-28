# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios y panel de administración.

## Cómo iniciarlo

```
npm install
npm start
```

Abrí [http://localhost:3000](http://localhost:3000).

## Persistencia

| Archivo | Rol |
|---|---|
| `db.json` | Estado local (usuarios, precios). **Está en `.gitignore`**, no se sube al repo. |
| `db.defaults.json` | Plantilla versionada. Es lo que usa el deploy en Vercel. |

En local el admin guarda en `db.json`. Para publicar esos cambios a producción, copiá a la plantilla y pusheá:

```
cp db.json db.defaults.json
git add db.defaults.json && git commit -m "update db" && git push
```

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`
