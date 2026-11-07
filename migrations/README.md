# Nota sobre migraciones

La carpeta oficial de migraciones V2 es **[`backend/migrations/`](../backend/migrations/)**. Esta carpeta raíz se conserva solo como referencia del diseño inicial.

La configuración activa `backend/wrangler.staging.jsonc` contiene ahora `"migrations_dir": "migrations"`, que resuelve a `backend/migrations` cuando Cloudflare utiliza `/backend/` como directorio raíz.

**No colocar nuevos scripts SQL en esta carpeta raíz.** Nunca ejecutar SQL de staging contra `daurel-db` (producción).
