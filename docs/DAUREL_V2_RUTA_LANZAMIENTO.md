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

## Estado de esta etapa

Implementado: compatibilidad **de estructura** del formulario público mediante un adaptador puro, con pruebas sintéticas. No implementado: importación de datos reales, cambio de endpoint en producción, acceso administrativo definitivo ni conexión automática a Telegram. El próximo trabajo es revisar los controles y el esquema de almacenamiento V1 en modo seguro.
