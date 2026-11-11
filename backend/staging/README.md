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

## 10. Centro de operaciones de staging (módulo operador)

URL `https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/v2/operator`.

- La página puede cargarse, pero **todos los datos y las operaciones** quedan tras `STAGING_TEST_TOKEN` en `worker.js`.
- Muestra estadísticas, bandeja de solicitudes, estado y nombre de cliente **ficticios**; permite buscar y filtrar sin acceder a clientes reales.
- Crea nuevos asuntos con `/v2/demo/requests` y el identificador `demo-*`, sin crear cuenta ni contraseña del cliente.
- `GET /v2/operator/api/queue`: únicamente solicitudes con `intake_channel='staging_demo'`, hasta 100 asuntos.
- `POST /v2/operator/api/status`: actualización validada por transición, con `Idempotency-Key`, estado esperado y actuación en `request_events`. Transiciones admitidas: nuevo → contactado → en atención → cerrado, además de cancelación y reapertura controlada. Sin comentarios de texto libre.
- `POST /v2/operator/api/invite`: invitación por **UUID exacto de solicitud**, exclusivamente al correo de prueba `daurelcontact@gmail.com`. Contiene enlace directo para `/v2/client`, uso único y 24 horas, limita reenvíos y revoca invitaciones pendientes anteriores.
- Las operaciones POST rechazan solicitudes sin `Origin` coincidente; las rutas técnicas no aceptan cookies de cliente como autorización de operador.
- Sin nuevos secretos ni migraciones D1. Conservar `ENVIRONMENT=staging` y no publicar este módulo en `daurel.com.mx`.
- El inicio de sesión de operadores reales aún NO está implementado: faltan cuenta nominal, roles, doble factor/seguridad adicional, registros de acciones por operador y controles de privacidad. No confundir el secreto técnico del laboratorio con credenciales definitivas de personal.

**Prueba manual:** abrir `/v2/operator`; ingresar la misma clave técnica del laboratorio; pulsar «Abrir mi panel»; cambiar el estado de una solicitud ficticia; pulsar «Enviar acceso» en un expediente. El correo recibido debe permitir entrar en `/v2/client` y consultar solo el asunto seleccionado. Para ver el historial, pulsar «Ver historial». No usar datos personales reales.

## 11. Actuaciones operativas y seguimiento compartido (solo staging)

La misma base D1 de pruebas alimenta el panel de operador `/v2/operator` y el portal cliente `/v2/client`, que funcionan tanto en computadora como desde el navegador del celular. No hay aplicación nativa ni WhatsApp integrado. Al volver a cualquiera de las pantallas se consulta la información actualizada, sin consultas continuas en segundo plano. El cliente también tiene botón «Actualizar».

El catálogo `GET /v2/operator/api/actions` contiene **16 actuaciones** organizadas:
- Contacto: WhatsApp intentado, llamada intentada, correo enviado, respuesta recibida, llamada atendida.
- Atención: cita programada, asesoría realizada.
- Documentos: documentos solicitados, recibidos, revisados.
- Seguimiento: seguimiento realizado, asunto canalizado, cliente informado.
- Gestión: trámite presentado, respuesta institucional recibida.
- Cierre: servicio concluido y confirmado.

Registro vía `POST /v2/operator/api/record` exige clave técnica y `Origin` correcto, JSON con `request_id`, `expected_status`, `action`, así como `Idempotency-Key`. Escribe un evento de bitácora identificado de forma determinista en `request_events` **sin nueva migración**. El asunto debe ser ficticio (`intake_channel='staging_demo'`). Se rechaza estado obsoleto, acciones no incluidas y operaciones sin autorización.

Cambios automáticos **con estado de origen exacto**:
- Respuesta de cliente o llamada atendida: `new → contacted`.
- Asesoría realizada, documentación revisada o trámite presentado: `contacted → in_attention`.
- Conclusión confirmada: `in_attention → closed`, con confirmación explícita en pantalla.

El intento de escribir por WhatsApp, llamar, enviar un correo, programar una cita o solicitar documentos **no equivale a contacto confirmado** ni cambia por sí solo el estado. Registrar una actuación es una declaración manual del operador; no se importan chats de WhatsApp personal. No registrar supuestos hechos a partir de abrir enlaces o aplicaciones. Los asuntos cerrados o cancelados requieren actuación consciente para reabrirse.

**Costo y canales**: este flujo no contrata ni conecta la API de WhatsApp. Reutiliza la infraestructura ya provisionada dentro de sus límites gratuitos; no garantiza que los proveedores mantengan permanentemente esos límites. En el futuro se evaluará una conexión oficial separada. No modificar `daurel-db` ni `main`.

## 12. Agenda operativa y semáforo por expediente (migración 0004)

Implementado en la rama `architecture/daurel-v2` para el mismo panel `/v2/operator`. NO está habilitado en producción.

**Instalación:** aplicar manualmente el SQL `backend/migrations/0004_followup_tasks.sql` exclusivamente en **D1 → daurel-staging → Explore Data → D1 Studio → Run all in sequence**. Son **3 instrucciones SQL**: una tabla y dos índices. No ejecutar en `daurel-db` y no utilizar `wrangler d1 migrations apply` mientras el historial de 0001–0003 siga sin conciliar. El endpoint `/health` indica `optional_followup_schema.ready`.

Sin instalar 0004, el panel anterior continúa disponible y la sección «Agenda de próximos pasos» mostrará una indicación específica. El Worker no crea tablas automáticamente.

La API de la agenda, siempre protegida con el `STAGING_TEST_TOKEN`:
- `GET /v2/operator/api/followups`: devuelve pendientes abiertos solo de `staging_demo` y fecha local `America/Mexico_City`, con semáforo calculado al consultar.
- `POST /v2/operator/api/followups/create`: recibe exclusivamente `request_id`, `action_code` y `due_date` en `YYYY-MM-DD`; `Idempotency-Key`, `Origin` y validación de calendario obligatorios. Fecha de hoy hasta 365 días. Solo expedientes abiertos y ficticios.
- `POST /v2/operator/api/followups/complete` y `/cancel`: cierran un pendiente existente con confirmación, y registran el cambio en `request_events`. No modifican el estado general del expediente ni afirman haber enviado mensajes a clientes.

**Semáforo:**
- Rojo = fecha anterior a hoy y pendiente abierto;
- Amarillo = vence hoy, mañana o pasado mañana;
- Verde = fecha posterior y pendiente abierto.

Los colores no representan cumplimiento ni progreso jurídico, solo **urgencia temporal del siguiente paso**. Las fechas vencidas se conservan visibles hasta completarlas o cancelarlas. Se pueden programar ocho tipos de tareas predefinidas: volver a contactar, solicitar o revisar documentos, programar cita, seguimiento ante autoridad, actualizar al cliente, revisar respuesta y comprobar plazo.

**Sin costos adicionales ni notificaciones:** esta versión muestra pendientes al abrir o actualizar el panel desde navegador/celular. No ejecuta tareas ni envía WhatsApp, correos, avisos de calendario o alertas automáticas en segundo plano. Esas funciones requieren diseño y pruebas posteriores (p.ej., Cloudflare Cron Trigger) antes de declararlas operativas.

**Prueba manual:** tras instalar 0004, recargar `/v2/operator` (Ctrl+F5), entrar con clave técnica, encontrar en un expediente activo «Próximo paso», elegir acción y fecha, pulsar «Programar pendiente». Debe aparecer en «Agenda de próximos pasos». Marcar «Hecho» y comprobar que desaparece de abiertos y queda en «Ver historial». Usar solo expedientes `demo-*` y datos ficticios. Una única tabla nueva, sin secretos adicionales.

## 13. Vista previa y alertas diarias Telegram (opt-in, sin WhatsApp)

La agenda `0004` ya funciona para asuntos ficticios. Nuevo botón en `/v2/operator`: **Recordatorios en Telegram → Ver mensaje de ejemplo**. La vista previa usa `GET /v2/operator/api/alerts/preview`, protegido por `STAGING_TEST_TOKEN`. No envía mensajes.

**Programación de Cloudflare:** `wrangler.staging.jsonc` define Cron `0 15 * * *`, equivalente a **09:00 hora de Ciudad de México**. El Worker implementa `scheduled()`, pero el envío se encuentra **apagado por defecto**. La programación no activa el envío por sí sola.

**Para habilitarlo explícitamente en un futuro ensayo**, son necesarios tres Secrets definidos SOLO en `daurel-backend-staging` (nunca en GitHub):
- `DAUREL_V2_TELEGRAM_BOT_TOKEN`: token de un bot Telegram bajo control del operador;
- `DAUREL_V2_TELEGRAM_CHAT_ID`: identificador numérico del chat privado que recibirá las pruebas;
- `DAUREL_V2_ALERTS_ENABLED`: texto exacto `true`, también en Secret. **No configurarlo** hasta confirmar la recepción de pruebas y consentimiento del destinatario.

No solicitar ni compartir los valores de los Secrets en chats, capturas, Github Issues o logs. Los mensajes de prueba evitan nombres, teléfonos, emails o información procesal; muestran únicamente folios **ficticios**, tipo de pendiente y fecha. No se importan conversaciones de WhatsApp personal.

Cada día se incluyen pendientes atrasados, del día y de mañana, hasta 25 entradas en la síntesis. No se envía mensaje si no hay pendientes. La tabla `integration_events` ya existente controla reintentos y reduce duplicados por día sin crear otra migración. Telegram no proporciona un envío exactamente-una-vez entre redes: un fallo después de aceptar el mensaje podría originar una repetición, por lo que NO debe prometerse entrega exactamente única.

Las pruebas automáticas usan un transporte Telegram simulado (nunca envían mensajes reales). Comprueban ruta de previsualización protegida, privacidad, desactivación por defecto, envío simulado, deduplicación, reintento tras fallo, y bloqueo fuera de staging.

**Costo:** diseño para operar en Cloudflare Workers + D1 + Telegram Bot API sin contratar un servicio nuevo, sujeto a los límites vigentes de las capas gratuitas. Si un recurso superara el límite de su plan, detener o reconfigurar el envío en lugar de incurrir en gastos.

**Chequeo de seguridad:** en la vista previa debe aparecer `delivery_enabled: false` mientras no haya consentimiento/secretos. El portal público `daurel.com.mx` y `daurel-db` permanecen independientes.

## 14. Conexión Telegram V2, sin alterar el bot de DAUREL V1

**Importante:** DAUREL V1 ya usa Telegram. Sus secretos residen en el Worker de **producción** `daurel-backend` y no deben tocarse, recuperarse por rotación de token ni copiarse a GitHub. Si no se dispone de una copia segura del token vigente, crear mediante **@BotFather** un bot nuevo exclusivamente para staging (gratis). **No ejecutar /revoke ni regenerar el token del bot V1**, pues podría interrumpir alertas reales.

### Configuración segura, solo daurel-backend-staging
1. En Telegram → @BotFather → `/newbot`, crear `DAUREL V2 Pruebas`, con username libre terminado en `bot`; guardar el token que devuelve **en Cloudflare Worker staging → Settings → Variables and Secrets**, Tipo **Secret** y nombre `DAUREL_V2_TELEGRAM_BOT_TOKEN`. No pegarlo en la conversación.
2. Abrir el nuevo bot desde Telegram y pulsar **Iniciar**.
3. Abrir `/v2/operator` con clave técnica. En «Recordatorios en Telegram», pulsar **Generar frase de vinculación** y enviar esa frase **como mensaje privado al bot**. Luego pulsar **Detectar mi chat**.
4. Copiar el número mostrado (no es el token) y guardarlo en `daurel-backend-staging` como Secret `DAUREL_V2_TELEGRAM_CHAT_ID`.
5. Volver a `/v2/operator`, pulsar **Comprobar conexión**, después **Enviar mensaje de prueba**. Se enviará a Telegram **solo por el clic y con confirmación de usuario**; hay un límite de 1 intento por minuto. El mensaje no contiene folios reales.
6. Mantener `DAUREL_V2_ALERTS_ENABLED` sin definir o en falso. **No activar el Cron de envíos automáticos** hasta confirmar que llega el mensaje de prueba al chat correcto.

`POST /v2/operator/api/telegram/discover` solo funciona con `STAGING_TEST_TOKEN` válido, `Origin` del mismo Worker, y exige una frase aleatoria exacta escrita en un chat privado durante la hora anterior. El token se usa **desde el servidor**, sin exponerlo en navegador ni red de terceros. `POST /v2/operator/api/telegram/test` requiere clic explícito, configuración lista y límite 1/minuto. `GET /v2/operator/api/telegram/status` muestra solo banderas booleanas, nunca secretos.

Cloudflare aplica el Cron definido en `wrangler.staging.jsonc`; el handler `scheduled()` respeta `DAUREL_V2_ALERTS_ENABLED` y la configuración del Worker de staging. Mantener `ENVIRONMENT=staging` y `DB=daurel-staging`. No hay cambios en `main`.
