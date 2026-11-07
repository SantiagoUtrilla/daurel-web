# DAUREL V2 — Worker de pruebas

Este directorio es **exclusivamente de staging**.

## Primer despliegue automático

- Rama de Cloudflare: `architecture/daurel-v2`.
- Root directory en Cloudflare: `/backend/`.
- Deploy command: `npx wrangler deploy --config wrangler.staging.jsonc`.
- Worker destino: `daurel-backend-staging`.
- Binding D1 `DB`: `daurel-staging` (`9a10d215-203b-438c-afae-049b29a57e58`).
- Las compilaciones de previsualización están desactivadas.

## Prueba de salud

Tras un despliegue exitoso, visitar:

`https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/health`

Resultado esperado: JSON con `status: "online"` y `database: "connected"`.

La ruta principal `/` puede devolver 404 porque staging solo implementa `GET /health`.
Esto es intencional y **no es una falla de despliegue**.

## Seguridad

- No usar `daurel-db` ni `daurel-backend` para pruebas.
- No desplegar `backend/legacy/worker.js`: se conserva únicamente como respaldo de referencia.
- No copiar secretos o datos reales a pruebas.
- No ejecutar migraciones remotas hasta disponer de esquema y pruebas validados.
- Este primer Worker no permite crear solicitudes y no envía avisos por Telegram.

## Próximo hito

Confirmar compilación exitosa en Cloudflare, consultar `/health`, y después diseñar/ensayar el esquema físico V2 en la base aislada.

## Migración V2 núcleo: preparada, aún no aplicada

El archivo `migrations/0001_v2_core.sql` define **18 tablas** con claves foráneas, índices, identificadores independientes y unicidad de eventos de entrada.

- Se probó localmente con SQLite, `PRAGMA foreign_keys=ON`, creando una base temporal y verificando restricciones de duplicados, relaciones y solicitudes múltiples.
- **Solo** se aplicará a `daurel-staging`, nunca a `daurel-db`.
- El despliegue de GitHub **no aplica automáticamente el SQL**; la base sigue con 0 tablas hasta ejecutar la migración.
- Preferencia para registrar la versión en D1: `npx wrangler d1 migrations apply daurel-staging --remote --config wrangler.staging.jsonc`, ejecutado desde la carpeta `backend`, tras la autenticación de Wrangler.
- Alternativa visual: abrir Cloudflare D1 `daurel-staging` → **Console**, pegar el SQL completo y usar **Execute**; esa vía manual **no registra la migración en `d1_migrations`**, por lo que en el futuro habrá que reconciliar el historial con Wrangler antes de otras migraciones.
- No es necesaria ninguna conexión con Telegram, backend de producción ni migración de clientes todavía.

Para comprobar el resultado en la consola D1: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`.
