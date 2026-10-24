# Migraciones DAUREL V2

Esta carpeta contendrá los archivos SQL versionados de DAUREL V2. **Aún no hay migraciones**: no se ha ejecutado ninguna en D1.

- La base de pruebas es `daurel-staging`, creada el 24 de octubre de 2026.
- No tocar `daurel-db` ni eliminar la tabla legacy `leads`.
- El esquema físico se diseñará desde el modelo lógico en `docs/DAUREL_V2_MODELO_LOGICO.md` y se probará en staging.
- Para utilizar Wrangler, la configuración es `backend/wrangler.staging.jsonc`; corroborar **database_name y database_id** antes de cualquier comando `--remote`.
- Nunca aplicar migraciones remotas sin revisar el SQL, validar datos de prueba y confirmar un plan de reversión.
- El directorio de migraciones es `../migrations` relativo al archivo de configuración de Wrangler.
