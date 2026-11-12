# DAUREL V2 · Control de lanzamiento y pendientes críticos

Actualizado: 11 de noviembre de 2026. Rama de desarrollo: `architecture/daurel-v2`. Entorno de pruebas: `daurel-staging`.

**Regla principal:** DAUREL V1 en `https://daurel.com.mx` continúa atendiendo solicitudes. No modificar `main`, el Worker `daurel-backend`, la base `daurel-db` ni las credenciales de Telegram V1 hasta validar el corte y su reversión. La función pública de pedir orientación **seguirá siendo gratuita y sin cuenta obligatoria**.

## Terminados y validados en pruebas

- [x] Estructura V2 base y laboratorio sintético de asuntos, partes y expedientes.
- [x] Acceso opcional de cliente por código de correo y permisos explícitos por expediente, no por mera coincidencia de teléfono o correo.
- [x] Revocación de accesos de **cliente** por expediente sintético desde el panel del propietario, separada de colaboradores: desactiva permisos, invalida invitaciones pendientes y registra auditoría. Solo en código de staging; **pendiente comprobación manual en navegador**. Pruebas end-to-end verifican que el cliente conserve únicamente otros expedientes concedidos y que lectores/gestores no puedan revocar.
- [x] Centro de operaciones en navegador y celular con estados, actuaciones, historial, pendientes y semáforo.
- [x] Cuentas administrativas separadas de las de clientes: activación de propietario y acceso por OTP; el usuario confirmó entrada, salida y reingreso.
- [x] Bitácora de acciones confirmadas, visible exclusivamente para el propietario.
- [x] Alta de colaboradores `reader` y `manager`, revocación de sesiones, OTP individual y autorización previa distinta de verificación. **110/110 pruebas GitHub Actions aprobadas en ejecución 43134216298** (11/11/2026).
- [x] Auditoría estructural de V1 por consultas solo lectura: tabla `leads` con 29 columnas.
- [x] Auditoría agregada de V1: **3 solicitudes, 3 folios distintos, 0 vacíos, 0 aceptaciones sin fecha**. Valores de estado `new`, `contacted`; urgencia `soon`, `48h`, `no`; prioridad `normal`.
- [x] Conversor y ensayo de migración V1→V2 con **solo registros ficticios**, transacciones, detección de cambios e idempotencia.
- [x] Telegram V2: programación, resumen y vista previa desarrollados; envío **desactivado** y conexión final diferida para no duplicar bot/tokens.

## Activación restante del equipo (solo staging)

- [x] Ejecutada **una vez** la migración `backend/migrations/0007_operator_approvals.sql` únicamente en `daurel-staging`; el usuario confirmó la operación manual.
- [x] Verificado `/health` → `optional_team_schema.ready: true`, `expected_tables: 2`, `missing_tables: []`.
- [x] Verificada sección «Administrar colaboradores» en `/v2/operator` con sesión de propietario.
- [x] Ensayo manual con segundo correo de prueba: autorización como lector, OTP, visualización de **1 expediente asignado** y ocultación del expediente civil ajeno; al **revocar la asignación** y actualizar la página, el usuario confirmó **0 expedientes visibles sin cerrar sesión** (11/11/2026). No se usaron datos de clientes reales.
- [x] **Desactivación total manual:** tras guardar el cambio del colaborador de pruebas `sountibeats@gmail.com`, el navegador en incógnito dejó de mostrar la sesión activa y rechazó solicitar otro OTP con «Este correo no está autorizado para operar DAUREL». Confirmación visual del usuario (11/11/2026). **Pendiente**: prueba manual adicional de rutas directas y verificación de `authenticated:false` en endpoint de estado, además de evaluación de seguridad preproducción.

## Bloqueadores del lanzamiento real (P0)

- [x] **Autorización por expediente en staging:** lectores y gestores no acceden por rol global; el propietario asigna cada expediente ficticio expresamente. El backend controla bandeja, contadores, agenda, historial y escrituras, además de revocar accesos. **Aún P0 para producción:** validar finalidad y aislamiento por cliente/profesional, protección de datos sensibles, auditoría por contenido, pruebas de penetración y recuperación.
- [ ] **Backend V1 y respaldo:** la copia referencial `backend/legacy/worker.js` ya fue auditada, pero falta comprobar si coincide con el Worker desplegado. Conteo confirmado en Cloudflare: **3 solicitudes reales**, y `/bookmark` de Time Travel registrado el 11/11/2026. **NO existe aún un respaldo independiente `.sql` ni una restauración verificada**. La vía local Wrangler se detuvo tras una alerta antivirus `IDP.HELU.PSE96`; no indicar desactivar AVG, reintentar CLI ni conceder más accesos. Evaluar un método alternativo oficial antes de migrar cualquier dato real y conciliar entradas recibidas durante el corte.
- [ ] **Importación privada reversible:** conservar los 29 campos, folio, ID histórico, fechas, consentimiento y datos operativos; no inventar eventos antiguos a partir del contador de seguimientos. Activar `0005_legacy_lead_details.sql` solo cuando el plan esté revisado y el entorno lo requiera. Conciliar conteos 3→3 al momento del respaldo, comprobando cambios desde el último recuento.
- [ ] **Formulario real:** enlazar la captura existente con V2 sin exigir cuenta, conservar Turnstile y limitación de abuso, revisar validaciones y privacidad. Probar varias solicitudes consecutivas y casos de fallo.
- [ ] **Portal de cliente real y diseño final:** eliminar textos de laboratorio y correo fijo de pruebas, permitir correos de cada cliente y acceso únicamente a asuntos autorizados, conservar la identidad gráfica oficial sin rediseñar el logotipo.
- [ ] **Endurecimiento de autenticación:** correo individual, autorización/recuperación de administradores, CSRF, límites por destinatario e IP, auditoría de fallos y revisión de seguridad. No asumir que OTP de email es protección suficiente para documentación confidencial.
- [ ] **Plan de corte + reversión:** ventanas, backup verificado, matriz de pruebas, medición de errores, prueba de restauración y procedimiento para regresar a V1.
- [ ] **Telegram definitivo:** solo al final, reutilizar el bot vigente V1 cuando sea seguro y configurar un único emisor. Verificar entrega sin duplicar avisos.

## Lo que no está terminado

El laboratorio de pruebas no equivale a la versión productiva. **No hay sincronización automática con WhatsApp personal**, ni app móvil nativa, ni importación de registros reales, ni recuperación histórica de actuaciones que V1 no almacenó. No prometerlo al usuario final.

## Orden de ejecución optimizado

1. Activar y comprobar `0007` en staging (una sola intervención en D1).
2. Verificar la autorización *por caso* ya implementada en staging y reforzar seguridad/privacidad del portal real.
3. Preparar integración real con V1 y respaldo controlado.
4. Completar pruebas con datos ficticios, interfaz definitiva y contrato de privacidad.
5. Hacer prueba de corte y reversión.
6. Autorizar despliegue real y activar Telegram sin repetición.

**Política de seguridad:** `daurel-db` y `main` no deben ser alterados por pruebas. Secretos solo en Cloudflare, nunca en GitHub o chats. Todo cambio de producción requiere autorización y respaldo verificado.
