# DAUREL V2 — Arquitectura de crecimiento multidisciplinario

**Fecha de decisión:** 11 de noviembre de 2026. **Estado:** propuesta de diseño, no despliegue. Rama `architecture/daurel-v2`.

## Principio central

Una sola plataforma, una identidad opcional por persona y múltiples expedientes independientes, incluso en profesiones diferentes. DAUREL no exigirá registro ni contraseña para enviar una primera solicitud gratuita; la cuenta es optativa para seguimiento. El correo verificado prueba control del buzón, **no** por sí solo la identidad jurídica ni la titularidad del asunto. Por eso no se deben conceder expedientes por mera coincidencia de correo, nombre o WhatsApp.

## Áreas y servicios

- **Jurídica:** laboral, civil, familiar, mercantil, administrativo y otras, mediante un catálogo ampliable.
- **Contaduría (ya ofrecida):** servicios contables, fiscales, trámites y orientación empresarial con profesionales autorizados.
- **Arquitectura (futura):** planos, expedientes de proyecto, licencias y regularizaciones con personal competente.
- **Ingeniería (futura):** valoraciones y servicios técnicos con especialistas competentes.
- Se añadirán áreas y servicios sin redefinir usuarios, folios ni permisos. No prometer servicios regulados sin verificar acreditación, alcance profesional y responsabilidades.

## Flujo propuesto a escala

1. **Captación gratuita:** visitante presenta solicitud; Turnstile y controles antiabuso; se crea folio de forma idempotente sin cuenta.
2. **Clasificación:** tipo de servicio + ubicación + prioridad + documentación + señales de urgencia. Reglas transparentes; IA, si se utiliza, solo sugiere y nunca valida por sí sola conclusiones profesionales de alto riesgo.
3. **Enrutamiento:** cola especializada por área, experiencia, disponibilidad y conflicto de intereses. Un profesional no ve otros asuntos de la persona ni los de otras áreas salvo asignación explícita.
4. **Verificación de cliente opcional:** código de email para sesión. El vínculo a expedientes requiere una credencial de reclamación expedida al solicitante verificado, una invitación individual o revisión de identidad/titularidad/representación. No revisar manualmente todo por defecto; sí los casos sensibles, de terceros o con evidencia insuficiente.
5. **Gestión por expediente:** responsable, participantes, actuaciones, pendientes, documentos, histórico, estados, medidas de calidad y fechas. Evitar convertir un intento de contacto en atención confirmada.
6. **Comunicación:** notificaciones opt-in por email/Telegram u otros canales habilitados y autorizados; registro de entrega distinto de cliente efectivamente atendido. No sincronizar WhatsApp personal sin integración real.
7. **Cierre y auditoría:** cierre verificable por rol, historial inmutable o append-only cuando proceda, encuesta de calidad, archivo y política de retención.

## Entidades de producto propuestas (no migrar aún)

- `service_areas`, `service_catalog`, `case_workflow_templates`, `case_actions` — catálogo y procesos sin código por materia.
- `accounts`, `parties`, `account_request_access`, `representations` — identidad diferenciada de solicitante, titular y representante.
- `service_requests`, `request_participants`, `case_assignments`, `followup_tasks`, `request_events` — seguimiento e intervención con permisos específicos.
- `professional_profiles`, `professional_credentials`, `availability`, `conflict_reviews` — asignación especializada basada en autorizaciones verificadas, no títulos autodeclarados.
- `documents`, `document_access`, `notification_outbox`, `notification_attempts` — documentos restringidos y notificaciones idempotentes.
- No crear por ahora estas tablas ni duplicar las existentes; primero mapear cada concepto a lo ya implementado, minimizando datos y migraciones.

## Segmentación y controles de acceso

- Propietario/administrador: supervisión y acceso por finalidad autorizada, con bitácora y posibilidad de delegar.
- Coordinador por área: su cartera autorizada, métricas agregadas, asignación condicionada.
- Profesional/gestor/lector: asuntos específicos, permiso de lectura o actuación. No acceso global por pertenecer a un área.
- Cliente/representante: expedientes cuyo vínculo esté verificado; autorización de un expediente no abre automáticamente otros de la misma persona.
- Administración de credenciales, revocación inmediata de sesiones y permisos, control de rutas del servidor, revalidación en acciones sensibles.
- Segregación de información privada entre áreas y evaluación de conflicto de intereses.

## Escalabilidad técnica

- Colas y workers separados para envío, clasificación y procesamiento de documentos; peticiones HTTP rápidas e idempotentes.
- Paginación de solicitudes en servidor, índices SQL y búsquedas acotadas; no cargar miles de expedientes al navegador. El límite actual de 100 en staging es solo laboratorio.
- Múltiples equipos con permisos y gestión delegada. El límite actual de 15 colaboradores en staging no es una capacidad objetivo.
- Observabilidad: tiempos de respuesta, errores, tasa de entrega, tareas vencidas, pendientes no asignados, actividad por especialidad.
- Respaldo restaurable, pruebas de recuperación, cifrado, retención, control de costos, controles antiabuso y políticas de privacidad.
- Escalar por métricas reales y pruebas de carga, no por pronósticos inventados.

## Fases

**Fase A (ahora, sin datos reales):** reparar acceso del portal simulado, validar invitación por caso, revocación del cliente, distinción de perfiles y pruebas de seguridad con fixtures. Conservar V1 operando.

**Fase B (antes de producción):** respaldar y probar restauración de `daurel-db`; verificar `leads`, consentimiento, versión de aviso y backend realmente desplegado; importar solo con ensayo idempotente reversible. Adaptar formulario gratis y acceso de cliente a correos propios sin vinculación automática basada solo en correo.

**Fase C (operación profesional):** catálogo multidisciplinario editable, roles por área, flujos configurables, documentación segura, revisión de identidad/representación donde corresponda, bandejas delegadas y auditadas.

**Fase D (crecimiento):** automatización de triaje y asignación bajo reglas auditables, notificaciones y recordatorios controlados, estadísticas, paginación y pruebas de carga; ampliar especialidades según profesionales disponibles.

## Estado real a noviembre de 2026

- `daurel.com.mx` y `daurel-db` siguen siendo V1 de producción. Tres solicitudes reales verificadas recientemente.
- `daurel-backend-staging` y `daurel-staging` usan expedientes de prueba, un destinatario fijo `daurelcontact@gmail.com` para el portal simulado y límites de laboratorio.
- Iniciar sesión por correo y revocar casos no equivale a identidad verificada de persona o representación profesional.
- No hay backup independiente de V1 restaurado/verificado. No migrar expedientes reales ni publicar V2.
- La alerta de AVG durante Wrangler implica que se evitará por ahora pedir comandos locales o desactivar antivirus.
- Código de corrección de `POST` vacío para portal de cliente: `client-portal-api.js` (pruebas simuladas, aún verificar en navegador el Worker desplegado).
