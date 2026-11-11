# DAUREL V2 · Inventario y mapeo REAL de `daurel-db.leads`

**Fuente:** capturas del usuario de `PRAGMA table_info('leads')` en Cloudflare D1 Studio, noviembre de 2026 (29 columnas) y código administrativo existente `main/public/admin.js`. Este inventario **no muestra ni lee filas de clientes**.

**Estado:** diseño y pruebas puramente sintéticas en rama `architecture/daurel-v2`. No se ha extraído información personal, ni ejecutado SQL de escritura, ni modificado `main`, `daurel-db` o el bot Telegram V1.

## Estructura confirmada

`daurel-db` muestra una tabla de datos de solicitudes `leads` más la tabla interna SQLite `sqlite_sequence`. No se observó una tabla independiente de actuaciones históricas; **no es posible reconstruir cada llamada, conversación, actuación o notificación a partir de un contador de seguimientos**.

| # | Columna real V1 | Conservación / destino previsto en V2 |
|---:|---|---|
| 1 | `id` (PK INTEGER) | ID interno de origen; `legacy_request_map.legacy_request_id` como texto y fuente `daurel_v1_leads`. Debe ser único, no reemplazarse por el teléfono |
| 2 | `request_id` (TEXT) | **Folio visible al usuario**, pasa a `service_requests.public_folio`. Confirmado porque `public/admin.js` muestra `lead.request_id` como folio |
| 3 | `persona` | `parties.kind` (particular → person; empresa → organization), con revisión de valores inesperados |
| 4 | `name` | `parties.display_name` (dato personal) |
| 5 | `whatsapp` | `party_contacts.contact_value`, sin asumir verificación ni vincular múltiples expedientes |
| 6 | `whatsapp_e164` | `party_contacts.normalized_value`, sin autorizar acceso por coincidencia |
| 7 | `email` | Contacto opcional en `party_contacts`, **no** identidad verificada de una cuenta |
| 8 | `location` | `service_requests.location_text` |
| 9 | `situation` | `service_requests.summary` (puede contener información personal/sensible) |
| 10 | `key_answer` | Respuesta complementaria: necesita almacenamiento privado de detalle V1, todavía sin destino definitivo |
| 11 | `category_front` | Categoría publicada: conservar por separado (no equiparar sin pruebas a `services`) |
| 12 | `category_internal` | Categoría operativa: conservar por separado; divergencias requieren revisión, no borrado |
| 13 | `urgency` | Urgencia original: **no inferir fechas procesales** |
| 14 | `priority` | `service_requests.priority` solo si coincide con valores permitidos: normal, medium, high |
| 15 | `routing_queue` | Cola operativa original, no está aún representada en `service_requests` |
| 16 | `status` | `service_requests.status` si valor es válido; confirmar distribución antes del corte |
| 17 | `follow_up_status` | Estado previo de seguimientos; no equivale a una actuación V2 nueva |
| 18 | `follow_up_count` (INTEGER) | Contador acumulado; **no fabricar 2 actuaciones detalladas si solo existe contador 2** |
| 19 | `privacy_consent` (INTEGER) | Señal de aceptación en V1; no basta sola para crear un consentimiento V2 con versión desconocida |
| 20 | `privacy_consent_at` (TEXT) | Fecha de aceptación histórica; conservar exactamente si existe, sin sustituir por fecha actual |
| 21 | `needs_human_review` (INTEGER) | Bandera operativa de revisión humana |
| 22 | `professional_assigned` (TEXT) | Profesional asignado, confirmado por `main/public/admin.js`; no implica cuenta/rol verificado |
| 23 | `deadline_verified` (INTEGER) | Indicador de plazo; revisión humana antes de generar alertas o fechas jurídicas |
| 24 | `deadline_basis` | Fundamento del plazo, conservar sin inventar fundamento faltante |
| 25 | `deadline_notes` | Notas de plazo, potencialmente confidenciales; requiere destino restringido |
| 26 | `documents_status` | Estado histórico de documentos; no implica archivos físicos disponibles |
| 27 | `documents_requested` | Información sobre requerimientos documentales; necesita almacenamiento detallado y control de acceso |
| 28 | `created_at` | `service_requests.opened_at` con sello temporal original y zona horaria por verificar |
| 29 | `updated_at` | `service_requests.updated_at`; no sustituir por hora de importación |

## Reglas obligatorias de migración

1. Cada `leads.id` determina un origen histórico separado, incluso cuando dos filas comparten número, correo o nombre. La unión de parties requiere prueba independiente de identidad/titularidad.
2. Preservar `request_id` como folio original **sin regenerarlo**. Los IDs nuevos V2 para las entidades internas son diferentes y se enlazan con `legacy_request_map` para lograr idempotencia.
3. No crear cuentas ni `account_party_access` / `account_request_access` a partir de `email` o `whatsapp` sin autorización.
4. Mantener los estados reconocidos y detener para revisión los desconocidos. Nunca reiniciar de oficio un expediente atendido a estado `new`.
5. No inventar eventos de seguimiento a partir de `follow_up_count`. El calendario de pendientes V2 requiere tareas registradas por un operador; `deadline_notes` no son automáticamente fechas ciertas.
6. No crear `consents` de V2 si la versión del aviso no está documentada; V2 exige `document_version NOT NULL`. Preservar `privacy_consent_at` como evidencia histórica de la fuente.
7. Las 13 columnas que V2 todavía no puede representar adecuadamente necesitan destino y controles de acceso antes de importar datos reales. El módulo `backend/staging/v1-lead-row.js` solo **planifica** su conversión y advierte sobre estos pendientes.
8. Programar respaldo verificable de V1, exportación cifrada autorizada, ensayo con datos **ficticios**, conciliación de recuentos y plan de reversión ANTES del corte.
9. V1 continúa respondiendo al formulario público; no cambiar `main` ni desactivar su Worker durante esta etapa.
10. Telegram queda para la activación final y sin doble emisor.

## Consulta para conocer el estado de los registros SIN exponer información personal

Se conserva en `docs/DAUREL_V2_AUDITORIA_AGREGADA_V1.sql`. Solo lee **recuentos** y valores categóricos de estado/urgencia, para detectar diferencias de contratos de datos sin listar nombres, solicitudes, teléfonos ni folios.

## Próxima implementación

Diseñar almacenamiento de información legada que falta en V2, una importación idempotente con transacciones y una comparación reproducible de conteos, **solo con filas sintéticas**. Más adelante decidir si los expedientes V1 se migrarán o se consultarán transitoriamente mediante un acceso backend controlado. La decisión exige revisar el código real del Worker V1 o su contrato de API y un respaldo autorizado.
