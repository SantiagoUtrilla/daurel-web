# DAUREL V2 — Expediente de incorporación de profesionistas

**Estado al 12 de noviembre de 2026:** diseño y primer piloto en `daurel-staging`, sin datos reales. Este documento **no autoriza** subir documentos ni considerar verificada una profesión. Producción `daurel-db` y `daurel.com.mx` permanecen independientes.

## Identidad del profesionista

- Mostrar **nombre completo + correo** en la ficha del equipo; no identificar personas solo por el correo.
- Relación con `account_id` existente, no crear cuenta duplicada.
- El nombre de prueba se conserva en `operator_professional_identities.full_name` (migración 0009).
- Guardar únicamente nombres **ficticios** en staging. Acceso de lectura y edición solo del propietario, bitácora de cambios.
- No confundir el nombre comercial, razón social o nombre artístico con el nombre legal acreditado. En producción habrá que definir la forma de acreditar identidad y representación.

## Requisitos de incorporación por tipo de servicio

Registro de **estatus** en `operator_professional_requirements` (migración 0009):

1. **Cédula profesional y habilitación aplicable**: verificar correspondencia, atribuciones y vigencia donde proceda. La cédula o acreditación aplicable depende de la profesión y del servicio específico.
2. **Identidad**: medio proporcional de verificación; INE solo cuando sea justificada y necesaria. Evitar conservar imágenes innecesarias.
3. **Contrato de colaboración**: documento privado, identificador de versión, firmantes y evidencia de aceptación/firma.
4. **Términos y condiciones**: consentimiento/aceptación vinculados al usuario autenticado, versión exacta y fecha/hora; no marcar aceptación desde la pantalla del administrador.
5. **Aviso de privacidad**: entrega/puesta a disposición y evidencia de la actuación conforme al flujo de captación aplicable.

El laboratorio crea los cinco requisitos con estado **`not_collected`**. La pantalla es **de solo lectura** para esos estados; no se permite autorizar una acreditación ni marcar términos aceptados sin un procedimiento verificable.

## Almacenamiento privado y controles antes de documentos reales

- **No almacenar imágenes de INE, contratos, firmas, actas o cédulas escaneadas en las tablas D1, KV ni el repositorio GitHub.** Los archivos deberán quedar en un depósito privado separado (por ejemplo, R2 privado) con control de acceso del servidor; las tablas solo guardarán identificadores opacos, tipo de documento, estado y referencias auditables.
- Cargas autenticadas, tamaño y tipo validados, detección de contenido potencialmente peligroso, límites por persona, cuarentena y comprobación de integridad.
- Acceso mínimo según función, verificación de identidad del solicitante y **separación de clientes y profesionistas**. Nunca habilitar un archivo con URL pública o una liga permanente sin control de autorización.
- Cifrado en tránsito y en reposo, restricciones de descarga, bitácora de consulta y revocación de autorizaciones.
- Políticas de consentimiento, finalidad, retención y eliminación, además de atención de solicitudes de derechos del titular. Validar el marco de protección de datos aplicable en México antes de lanzar el módulo.
- La copia de INE o datos adicionales se solicitará **solo si es necesaria** para el servicio y la relación contractual; evaluar métodos de verificación menos invasivos.
- Separar contratación, verificación de habilitación, asignación operativa y acceso al expediente; aprobar una credencial no significa dar acceso a todos los asuntos.

## Hitos técnicos

- [x] 0008: especialidades declaradas y disponibilidad, sin verificación.
- [x] 0009: nombre de profesionista + cinco requisitos en estatus inicial, solo staging. **Pendiente de aplicar por Cloudflare D1 Console**.
- [x] API de alta de nombre ficticio: solo propietario, origen validado, lista de campos cerrada y bitácora.
- [x] Nombre visible junto al correo, formulario desplegable y lista documental no editable.
- [ ] Desarrollar portal de incorporación *del propio profesionista*, distinto del portal del cliente.
- [ ] Elegir mecanismo seguro de archivos privados, retención y autenticación reforzada.
- [ ] Comprobar cédula/atribuciones por servicio, con intervención humana donde proceda.
- [ ] Establecer contratos y aceptación de términos versionados con evidencia verificable.
- [ ] Registrar conflictos de interés, carga real, disponibilidad y supervisión.
- [ ] Pruebas de privacidad, respaldo, eliminación y recuperación antes de producción.

**Regla:** ninguna especialidad, nombre o estatus sin evidencia puede activar distribución automática de asuntos reales.
