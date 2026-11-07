# DAUREL V2 — Worker de pruebas

Este directorio es **exclusivamente de staging**. No recibe datos reales ni modifica producción.

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

Confirmar la comprobación automática de 18 tablas en `/health`, y después implementar y probar la API V2 usando solamente datos ficticios.

## Migración V2 núcleo: ejecución manual realizada (7 de noviembre de 2026)

El fundador ejecutó desde Cloudflare D1 Studio el archivo `migrations/0001_v2_core.sql` con la opción **Run all in sequence**. La captura final informa **Executed 29/29**, y las tablas nuevas aparecen en el navegador de Studio.

- **18 tablas y 11 índices previstos.** La captura confirma las 29 instrucciones ejecutadas; la nueva ruta `GET /health` verificará automáticamente la existencia de las 18 tablas esperadas y mostrará `schema.ready`.
- La base correcta es `daurel-staging`. No modificar `daurel-db`, ni importar datos reales todavía.
- **No volver a ejecutar manualmente el SQL.**
- **Pendiente importante:** Studio no registra esta ejecución en la tabla de seguimiento `d1_migrations` de Wrangler. Antes de futuras migraciones, conciliar el historial con el comando oficial sobre **solo** `daurel-staging`. Como el SQL base usa `IF NOT EXISTS`, se podrá evaluar un primer `wrangler d1 migrations apply daurel-staging --remote --config wrangler.staging.jsonc` para registrar la versión; verificar antes que no haya deriva de esquema y que el comando apunte a la base correcta. No automatizar esta operación sin la revisión correspondiente.
- Al consultar `/health`, el resultado esperado es `status: "online"`, `database: "connected"`, `schema.ready: true`, `schema.expected_tables: 18` y `schema.found_tables: 18`.

Siguiente fase: API V2 en pruebas con autenticación estricta y datos ficticios; no exponer rutas de creación públicas antes de implementar controles y pruebas.
