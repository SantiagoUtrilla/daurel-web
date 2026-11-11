# DAUREL V2 · Ruta de integración definitiva sin trabajo duplicado

Fecha de revisión: noviembre de 2026.

## Decisión acordada: Telegram al lanzamiento, no otro bot ahora

- DAUREL V1 ya tiene un bot Telegram en operación. No regenerar ni revocar el token de V1.
- El Cron y el envío diario de V2 están desarrollados en staging, pero permanecen desactivados mientras no se configuren secretos de V2. La vista previa de avisos está disponible.
- **No crear otro bot de pruebas salvo necesidad concreta**. El token de Telegram se asocia al bot, no a la versión de DAUREL. Si se conserva el token vigente en un lugar seguro, se puede configurar en el backend definitivo al momento del corte, con consentimiento del destinatario.
- Durante la migración hay que decidir qué Worker será el **único emisor** de cada clase de aviso. No permitir que V1 y V2 manden avisos duplicados desde el mismo calendario.
- No mover secretos de producción a GitHub, código fuente, capturas ni conversaciones. No tocar el Worker de producción hasta un plan de corte probado.

## Compatibilidad comprobada con el formulario actual de daurel.com.mx

El código actual en `main/public/script.js` emite un `POST /solicitudes` a `https://daurel-backend.lmsantiagoutrilla.workers.dev` (véase `main/public/config.js`) con 12 campos:

`persona`, `situation`, `key_answer`, `category_front`, `category_internal`, `urgency`, `priority`, `name`, `whatsapp`, `location`, `privacy_consent`, `turnstile_token`.

- El servicio es gratis y no requiere registro.
- Turnstile se verifica **en el servidor**. La mera presencia del token no acredita verificación.
- Prioridad alta solo cuando `urgency=48h`. Otros valores de V1: `soon`, `no`, `unknown`.
- Categorías de V1: laboral, accidente, deuda, familiar, marca, citatorio, contrato, general.
- El adaptador puro `backend/staging/v1-intake-contract.js` preserva la clasificación, la descripción inicial, respuesta, tipo de solicitante, contacto, municipio, prioridad y constancia de aceptación inicial. **No escribe en base de datos ni importa usuarios.**
- El folio público y el ID original se crean en el backend de V1, no en el payload: hay que conservarlos al importar la fuente persistida. En V2, `legacy_request_map` permite conservar la equivalencia y evitar duplicados.
- La aceptación `privacy_consent=true` no demuestra por sí misma versión del aviso, momento de aceptación ni identidad. Antes de migrar hay que revisar la evidencia almacenada y requisitos de privacidad. No inventar fechas ni versiones.
- Nombre o teléfono coincidente **NO autoriza** el acceso a una cuenta; esa relación siempre requiere evidencia de titularidad/representación y concesión explícita.

## Lo que falta para un lanzamiento responsable (en orden)

1. **Acceso administrativo de verdad:** cuentas individuales, roles mínimos, sesiones protegidas, recuperación y auditoría. El `STAGING_TEST_TOKEN` existente es herramienta técnica, no credencial definitiva del operador.
2. **Contrato y estructura reales de V1:** leer esquema/tablas existentes de `daurel-db` en modo solo lectura, sin extraer ni mostrar datos personales. El backend real V1 no está en el mismo árbol de archivos del sitio estático `main`; hay que consultar su código por vía segura. Comprobar folios y estados.
3. **Importación idempotente sin pérdida:** crear simulación en base de pruebas con datos completamente ficticios; cotejar folios, asuntos, consentimientos, teléfono y cronología, y no mezclar casos por contacto. Diseñar respaldo y reversión.
4. **Formulario V2 productivo:** conservar el formulario gratuito actual, habilitar Turnstile y límites de abuso con pruebas reales de seguridad, y conectar su POST al nuevo modelo sólo después de validación.
5. **Portal de cliente definitivo:** email individual, verificación por correo y autorización de casos gestionada por DAUREL, sin tokens técnicos o códigos largos visibles al usuario; documentos sensibles solo tras autorización robusta.
6. **Panel operador, agenda y avisos:** operar con casos reales únicamente cuando los permisos sean adecuados; comprobar recordatorios, zona horaria y exclusión de casos cerrados.
7. **Interfaz y marca oficial:** reutilizar logo, tipografía y diseño correctos, no interfaces de laboratorio.
8. **Pruebas del corte:** tests, respaldos, no duplicidad, plan de reversión, HTTPS, privacidad y control de errores; observar el sistema antes de desmantelar V1.
9. **Telegram al final:** usar el bot V1 existente si hay token seguro; configurar secreto y chat en el Worker definitivo, probar un envío autorizado, desactivar el mecanismo equivalente V1 y habilitar V2 para evitar mensajes duplicados. No regenerar token si no hace falta.

## Protección de producción

- `main` es la web actual `https://daurel.com.mx`. No editarla hasta autorizar el despliegue.
- `architecture/daurel-v2` es la rama de desarrollo y `daurel-staging` es la base de prueba.
- `daurel-db` contiene solicitudes reales. Nunca aplicar migraciones 0001–0004 allí, ni importar una base mediante acciones de laboratorio.
- Las tablas 0001–0004 se aplicaron manualmente a staging; conciliar el historial de migraciones antes de automatizarlo. No asumir que el historial Wrangler está correcto.

## Auditoría inicial de V1: solo lectura, sin datos personales

Se preparó la consulta revisada `docs/DAUREL_V2_CONSULTA_SOLO_LECTURA_V1.sql`. Ejecútese **únicamente bajo D1 → daurel-db → Explore Data** en el editor SQL de Cloudflare. Es un `SELECT` de metadatos de `sqlite_master` y `pragma_table_info` que devuelve únicamente **nombres de tablas y columnas**, no filas de usuarios, ni teléfonos, ni folios, ni expedientes. No ejecutar scripts de migración en esa base.

Objetivo: identificar las tablas de solicitudes, eventos, consentimiento, estado y vínculo a folio de V1 para diseñar después un mapeo compatible, una importación idempotente y un plan de reversión. Hasta que se conozca el esquema real, **no escribir scripts que importen información personal de producción ni asumir tablas o campos hipotéticos**.

## Estructura real de V1: 29 columnas confirmadas

El usuario ejecutó `PRAGMA table_info('leads')` sobre `daurel-db` en Cloudflare D1 Studio. El inventario íntegro quedó documentado en `docs/DAUREL_V2_MAPEO_REAL_LEADS.md` y el planificador puro se implementó en `backend/staging/v1-lead-row.js` con pruebas sintéticas.

El folio visible se guarda en `leads.request_id` (confirmado además en el panel `main/public/admin.js`), mientras que `leads.id` es la identidad interna del registro legada. También se confirmaron los campos `privacy_consent_at`, `follow_up_status`, `follow_up_count`, `professional_assigned`, `deadline_verified`, `deadline_basis`, `deadline_notes`, `documents_status`, `documents_requested`, `created_at` y `updated_at`.

**Limitación histórica:** en la base V1 solo se observó `leads` y la tabla interna `sqlite_sequence`. No hay evidencia en ese esquema de un historial de actuaciones por eventos; los contadores no permiten recrear actuaciones individuales. Antes de importar, preservar los campos legados no representados por V2 y mantener todo en contexto privado.

**Siguiente lectura segura:** `docs/DAUREL_V2_AUDITORIA_AGREGADA_V1.sql` consulta exclusivamente recuentos y categorías de estado/urgencia/prioridad. No devuelve información de clientes. Útil para detectar valores inesperados y validar futuros recuentos, sin extraer datos reales.

## Auditoría agregada confirmada y ensayo transaccional

El usuario ejecutó una consulta de solo lectura sobre `daurel-db.leads`. Resultado: **3 solicitudes, 3 folios distintos, 0 folios vacíos, 0 consentimientos marcados como aceptados sin fecha**. Valores de estado observados: `new`, `contacted`; urgencia: `soon`, `48h`, `no`; prioridad: únicamente `normal`. La captura no incluye cuántas solicitudes hay por cada estado, ni vincula la urgencia `48h` con una fila concreta. **No inferir valores fila por fila ni modificar prioridades.**

Se diseñó `backend/migrations/0005_legacy_lead_details.sql` para preservar evidencia operativa V1 que no cabe en las tablas V2. Se implementó `backend/staging/v1-synthetic-import.js` **sin ruta web** y restringido a fixtures inequívocamente ficticios, con inserción transaccional, detección de duplicados y preservación de folio, estado, fecha y consentimiento legado sin emitir cuentas ni autorizaciones. La migración 0005 **NO está aplicada en Cloudflare** y solo se ejecuta en SQLite de memoria durante pruebas.

En GitHub Actions pasan **78 pruebas** (8 nuevas de migración simulada). Los ensayos usan exclusivamente tres expedientes inventados y confirman reversión si existe un folio repetido, no fusión por WhatsApp, no fabricación de eventos históricos y rechazo de filas reales. **Nunca usar estas pruebas para importar directamente `daurel-db`.**

Próximos bloqueadores para migrar registros reales: respaldo verificable y reversión, consentimiento/aviso de privacidad, controles de acceso administrativo y revisión del comportamiento del backend V1. Los tres registros reales todavía pertenecen íntegramente a V1.

## Estado de esta etapa

Implementado: compatibilidad estructural de formulario V1, mapeo completo de 29 columnas persistidas de `leads` a un plan sin escrituras y pruebas sintéticas. Realizado: auditoría agregada V1, diseño del almacenamiento de metadatos legados y ensayo transaccional de importación ficticia con idempotencia. Pendiente: respaldo y migración de datos reales, permisos administrativos definitivos, controles de protección de datos y corte reversible. No se han importado datos reales ni cambiado el endpoint de producción; Telegram queda para el corte final.
