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
