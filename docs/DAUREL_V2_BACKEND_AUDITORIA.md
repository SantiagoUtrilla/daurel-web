# DAUREL V2 — Recuperación y auditoría del Worker

Fecha: 2026-10-24. Se leyó el `worker.js` de Cloudflare suministrado por el fundador mediante texto pegado, se eliminaron escapados de Markdown y se verificó su sintaxis JavaScript. El código recuperado quedó en `backend/legacy/worker.js` **para referencia, no para despliegue**. No se incluyeron valores de Secrets: el código refiere a `env.*`.

## Funciones verificadas en legacy

- `POST /solicitudes`, validaciones, Turnstile, folio y persistencia en `leads` D1.
- API del panel: listado, cambio de estado, detalles; `ADMIN_API_KEY`.
- Botones/webhook Telegram y configuración de webhook.
- `scheduled`: alertas de seguimiento día 1 y día 3, Telegram.

## Hallazgos relevantes para V2

1. **Seguridad:** la configuración de webhook Telegram es invocable desde una ruta sin autenticación; añadir control estricto y, preferiblemente, convertir el setup en acción operativa restringida antes de reutilizarla.
2. Los valores CORS no sustituyen autenticación: bloquear y autorizar todo acceso por identidad, permiso y recurso.
3. El esquema `leads` mezcla cliente, contacto, solicitud, profesional y seguimiento, lo cual V2 separará sin alterar legacy.
4. La creación legacy de folio reintenta colisiones UNIQUE pero no introduce una clave de idempotencia de entrada, por lo que un envío repetido puede convertirse en solicitudes duplicadas.
5. Las notificaciones se envían de forma asíncrona después de guardar datos; V2 necesita bandeja de salida, estado de entrega y reintentos idempotentes.
6. Los recordatorios ejecutan envío y después actualización; bajo ejecución concurrente podrían intentar notificaciones duplicadas. V2 usará reclamación de jobs/estado transaccional.
7. El frontend solicita WhatsApp; V2 permitirá solicitudes sin teléfono si procede de otro canal y promoverá captura progresiva.
8. El listado del panel legacy limita resultados a 200 sin paginación SQL real. V2 tendrá paginación en backend.
9. No reconstruir SQL legacy adivinando: obtener `CREATE TABLE leads` o esquema mediante inspección de solo lectura antes de migrar información.
10. Las pruebas de despliegue deben confirmar que D1 binding `DB` apunta sólo a `daurel-staging` y que ningún cron ni Telegram está habilitado en staging.

## Staging seguro de arranque

- `backend/staging/worker.js` solo responde `GET /health` con una consulta D1 `SELECT 1`; el resto devuelve 404. No consume secrets, no procesa clientes ni envía mensajes.
- `backend/wrangler.staging.jsonc` se dirige expresamente a `daurel-backend-staging` y `daurel-staging` (ID verificado mediante captura).
- No hay configuración de horarios, integraciones reales ni URLs del backend de producción.
- No se ha desplegado ningún Worker de staging ni se han ejecutado migraciones.

**Próximo paso manual en Cloudflare:** crear Worker separado denominado `daurel-backend-staging`, sin conectar aún redes reales; conectar el binding `DB` a `daurel-staging` y verificar su página de configuración. Después se incorporarán funcionalidades V2 en ramas y con pruebas.
