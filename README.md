# Catálogo Lupo B2B

Catálogo mayorista con usuarios, listas de precios y panel de administración.

## Cómo iniciarlo

```
npm install
npm start
```

Abrí [http://localhost:3000](http://localhost:3000).

## Persistencia

Hay **una sola base**: `db.json` (usuarios, listas, precios).

Es el mismo archivo en local y en producción (viaja en el repo/deploy).

En local el admin lo actualiza solo. Para que producción quede igual: `git add db.json && git commit && git push`.

## Accesos iniciales

- Administrador: `admin` / `admin123`
- Cliente demo: `cliente` / `cliente123`
