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
