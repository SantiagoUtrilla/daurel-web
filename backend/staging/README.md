# DAUREL V2 — Laboratorio API de staging

**Ambiente:** \`daurel-backend-staging\`, enlazado exclusivamente a D1 \`daurel-staging\`. No usar datos de clientes reales.

## 1. Protecciones

- La API solo funciona si \`ENVIRONMENT=staging\`.
- Para \`POST /v2/demo/requests\` y \`GET /v2/demo/clients/:client_key\` se exige el Secret \`STAGING_TEST_TOKEN\` de mínimo 32 caracteres.
- El token es una contraseña **técnica de pruebas**, NO una contraseña para el cliente de DAUREL.
- El formulario público de producción continúa sin cambios; no se habilita registro ni autenticación de clientes.
- Los únicos campos permitidos son \`client_key\` (empieza con \`demo-\`) y \`case_type\` (general, laboral, civil, marcas).
- No se permite guardar nombres, WhatsApp, emails ni texto libre mediante esta API.
- No se habilita CORS para sitios externos; no hay notificaciones, cron, Telegram o pagos.
- Se envían las operaciones preparadas a D1 mediante \`batch\`, con rollback en caso de errores.
- Se exige \`Idempotency-Key\` para impedir solicitudes duplicadas por reintentos; su reutilización con contenido diferente produce 409.
- \`/v2/demo\` es una pantalla de laboratorio (robots noindex) que no conserva la clave en almacenamiento del navegador.

## 2. Única configuración manual en Cloudflare

1. Workers & Pages → \`daurel-backend-staging\` → **Settings** → **Variables and Secrets** → **Add**.
2. **Type:** \`Secret\` (NO Text/Plaintext).
3. **Variable name:** \`STAGING_TEST_TOKEN\`.
4. **Value:** secreto aleatorio generado por el administrador, de **32 o más caracteres**; guardarlo de forma privada para la prueba. No enviarlo al chat, no subirlo a GitHub.
5. **Deploy** para guardar el secreto.

No es necesario tocar el Worker \`daurel-backend\` de producción. Si algún cambio en GitHub despliega posteriormente la rama staging, el código seguirá usando \`env.STAGING_TEST_TOKEN\` sin publicar su valor.

## 3. Pruebas desde navegador (sin consola ni terminal)

Abrir: \`https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/v2/demo\`.

- Introducir la clave técnica de staging, cliente \`demo-cliente1\`, categoría laboral.
- **Crear asunto** → HTTP **201**, \`replayed: false\`; aparece un folio DAU.
- **Repetir envío** → HTTP **200**, \`replayed: true\`; **mismo** \`request_id\`, mismo folio.
- Seleccionar civil y pulsar **Crear asunto** → HTTP **201**, **nuevo** folio pero mismo cliente ficticio.
- **Ver asuntos del cliente** → \`count: 2\` y dos solicitudes; una sola entidad \`party\`.

La página puede abrirse sin clave, pero los endpoints que leen/escriben datos siempre requieren autenticación. El secreto solo se guarda en memoria del formulario durante su uso y no se manda a terceros.

## 4. Pruebas de calidad

Ejecutar en un clon GitHub local (sin secretos) \`node --test backend/staging/demo-api.test.mjs\` con Node 22. Incluye SQLite local en memoria, comprobación de integridad, reenvíos, cliente único y varias solicitudes.

Un workflow de GitHub Actions está preparado en \`.github/workflows/staging-tests.yml\`; si la cuenta tiene Actions habilitado, ejecutará las pruebas con cada cambio relevante.

## 5. Pendientes antes de avanzar a usuarios reales

- Conservar y después reconciliar la migración inicial ejecutada manualmente: no figura aún en el registro \`d1_migrations\`.
- Integrar controles públicos para captcha/verificación de origen, antifraude, consentimiento, retención, sesiones de invitado y perfiles.
- Implementar políticas de autorización por solicitud/cliente para el futuro panel V2.
- Migrar información legacy solo tras ensayar y revisar una estrategia de corte verificable.

**Nunca** usar esta API de laboratorio para capturar clientes reales.

## 6. Panel administrativo V2: primera versión de lectura

URL: `https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/v2/demo/admin`.

- Introducir el **mismo** `STAGING_TEST_TOKEN` configurado en el Worker de pruebas. No crear otra clave.
- **Cargar panel**: solicita `GET /v2/demo/admin/data` con Bearer token.
- Muestra clientes únicos, total de solicitudes, nuevas y en atención, y una tabla con folio, cliente ficticio, asunto, estado y fecha.
- Permite filtrar y buscar localmente, sin escribir en D1.
- El endpoint comprueba la autorización en el Worker, selecciona **solo** `intake_channel = 'staging_demo'` y limita la lista a las 100 solicitudes recientes; las cifras totales se calculan en SQL sobre toda la información sintética.
- No hay acceso a expedientes, teléfonos ni información real y no se modifica ningún estado. No es todavía el panel administrativo de producción.
- El código y pruebas se publican desde la rama `architecture/daurel-v2` en GitHub y se despliegan automáticamente a `daurel-backend-staging`.
- Antes de usarse con datos reales: roles/usuarios, autenticación por sesión, autorización por recurso, paginación real, auditoría, revisión de conflictos y protección del panel.

### Comprobación manual de la primera versión

Después de confirmar que el nuevo despliegue esté en **Ready**, entrar al panel, pegar la clave técnica y pulsar **Cargar panel**. Deben mostrarse al menos los dos asuntos ficticios `demo-cliente1` (laboral y civil) creados en el laboratorio. No hay que ejecutar SQL ni actualizar los Secrets.

## 7. Expediente único por cliente — nueva funcionalidad V2

El expediente de prueba se abre en:
`https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/v2/demo/dossier`

También existe un enlace **Ver expediente** en cada fila del Panel Administrativo V2:
`/v2/demo/admin`. Preselecciona el cliente ficticio mediante un parámetro de URL, sin incluir el Secret.

**Flujo manual (sin terminal ni SQL):**
1. Abrir un expediente, introducir el `STAGING_TEST_TOKEN` de staging ya configurado.
2. El cliente ficticio `demo-cliente1` contiene al menos dos asuntos de prueba (laboral y civil).
3. Pulsar **Abrir expediente** y seleccionar cada asunto: aparece su propia cronología.
4. Elegir una actuación predefinida (**Documentación revisada**, **Seguimiento realizado** o **Solicitud de información**) y pulsar **Agregar actuación**.
5. Pulsar **Repetir última actuación**: la API debe devolver `replayed: true` sin duplicar el evento.
6. Abrir el otro asunto: su cronología no recibe la actuación del primero.

**API** (todas las rutas de datos requieren Bearer `STAGING_TEST_TOKEN`):
- `GET /v2/demo/dossiers/:clientKey` devuelve un cliente ficticio, máximo 30 asuntos y hasta 30 eventos por asunto.
- `POST /v2/demo/requests/:uuid/events` exige `Idempotency-Key`, `client_key`, `action` (review, followup, information), sin texto libre.
- Escritura con `INSERT OR IGNORE ... SELECT` condicionada a pertenencia a un cliente de `staging_demo`, con identificador de actuación determinista basado en hash SHA-256 de requestId+idempotency-key.
- Repetición idéntica devuelve 200; reutilización de la misma clave con otra actuación devuelve 409.
- Los eventos se guardan en `request_events` ya existente; **no se necesita nueva migración** ni una tabla adicional.
- El panel y la API no usan nombres, teléfonos, expedientes o clientes reales y no ejecutan cambios de estado de V1.
- Pruebas GitHub Actions cubren la separación de dos historiales, idempotencia, autorización y aislamiento.

**Pendientes para producción:** roles, permisos por recurso, historial firmado/auditado y transición de estados, conciliación del historial de migraciones D1, límites de uso y validación de consentimientos. No usar esta pantalla como panel público.

## 8. Resend: prueba de entrega protegida, sin login todavía

Resend verifica el dominio `daurel.com.mx` y el Worker staging debe tener:
- `RESEND_API_KEY` tipo **Secret**: solo permisos de envío para `daurel.com.mx`.
- `AUTH_EMAIL_FROM=acceso@daurel.com.mx` tipo **Text**.
- `STAGING_TEST_TOKEN` tipo **Secret** ya configurado para pruebas.

Abrir `https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/v2/demo/mail`, introducir el secreto técnico **sin compartirlo** y pulsar **Enviar correo de prueba**. El mensaje se envía únicamente a `daurelcontact@gmail.com`, nunca a destinatarios ingresados libremente. **Es una prueba de entrega: no crea cuentas ni contiene OTP válidos.** Revisar bandeja de entrada y spam.

El endpoint POST `/v2/demo/mail/test` está protegido con el mismo Bearer token del laboratorio y no admite body. Usa `integration_events` de la migración 0001 para permitir **un intento por minuto**, sin necesidad de tablas nuevas. Si Resend rechaza el envío, devuelve error genérico sin exponer el API Key. La prueba usa Idempotency-Key por minuto hacia Resend.

**Estado actualizado (noviembre 2026):** las migraciones `0001`, `0002` y `0003` ya fueron aplicadas MANUALMENTE en `daurel-staging` y validadas por el usuario. Sigue pendiente conciliar `d1_migrations` antes de habilitar migraciones automáticas. No aplicarlas en `daurel-db`. La prueba inicial de envío de Resend no concede acceso a expedientes.

Si Resend responde que el dominio no está permitido, revisar primero el remitente verificado y el ámbito de la API Key antes de cambiar DNS. No eliminar registros MX/SPF ya existentes de Cloudflare.

## 9. Portal unificado de cliente simulado (SIN clave técnica)

URL: `https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/v2/client`.

La experiencia de cliente está separada del laboratorio técnico:
- La pantalla abre la sesión existente automáticamente; si está activa, enseña solo los asuntos de `account_request_access` que se hayan concedido y no revocado.
- Si la sesión caducó, muestra **un solo inicio de sesión con un código de seis dígitos**. En la versión de staging, el destinatario es FIJO: `daurelcontact@gmail.com`.
- Rutas `/v2/client/api/{start,verify,session,logout,cases,accept}`. No exigen `STAGING_TEST_TOKEN`, pero siguen limitadas al Worker `ENVIRONMENT=staging` y **no tienen acceso a datos de producción**.
- Emisión de código limitada a 1/minuto (límite anterior de OTP compartido) y 6 por día para la prueba de cliente. Solo se acepta POST desde el origen exacto; no se aceptan correos enviados en el cuerpo.
- Invitaciones emitidas desde el panel TÉCNICO incluyen un enlace con `#invite=...` (fragmento de URL); la vista de cliente lo consume después de verificar el correo y limpia el fragmento inmediatamente del navegador. No requiere copiar el código largo ni concederse acceso por adivinar un folio.
- No se crean ni vinculan permisos automáticamente por coincidencia de correo. El técnico envía la invitación de un expediente sintético y solo se permite consultar ese expediente al aceptarla.
- La cuenta para solicitar un servicio sigue siendo opcional. Se conserva intacta la producción en `main` / `daurel.com.mx`.
- Este piloto NO se debe publicar para clientes reales todavía. Falta Turnstile, correos variables verificados, identidad y representación, controles de bloqueo antiabuso/abuso de invitaciones, sesiones por roles, avisos de privacidad y panel de operador con permisos. El envío público actual es solo al correo fijo de DAUREL.
- Las pruebas automáticas verifican rechazo sin sesión, rechazo de otros orígenes, límite diario, acceso por invitación específica y cierre de sesión.

**Prueba manual breve:** abrir `/v2/client` y consultar el asunto laboral ya autorizado por la cuenta de prueba. Si no hay sesión, usar el botón «Recibir código de acceso». No hace falta ingresar la clave técnica.
