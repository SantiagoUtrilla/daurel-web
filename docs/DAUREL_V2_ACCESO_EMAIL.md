# DAUREL V2 — Acceso opcional con correo verificado
**Estado: preparado en código, NO habilitado todavía para clientes.**

## Experiencia elegida

1. Un visitante puede solicitar servicios sin cuenta, correo verificado ni contraseña.
2. Cuando quiera consultar sus expedientes, escribe su correo y pide iniciar sesión.
3. DAUREL envía un código temporal a ese correo. El cliente lo confirma.
4. Se crea o reconoce una cuenta independiente del registro del cliente. Sin contraseña.
5. DAUREL muestra **solo** asuntos cuya titularidad/representación esté expresamente acreditada en `account_party_access`.
6. Un correo coincidente con el que figura en una solicitud **no basta** para vincularla. La cuenta no hereda expedientes sin verificación adicional.

## Estado técnico en GitHub

- `backend/migrations/0002_optional_accounts.sql`: 7 tablas para cuentas, correos verificados, permisos, desafíos de login, sesiones, límites y auditoría.
- `backend/staging/auth-core.js`: validación de correo, OTP aleatorio de seis dígitos, HMAC-SHA256 de OTP, sesiones aleatorias de 32 bytes con hash, consulta de permisos explícitos.
- `backend/staging/email-provider.js`: adaptador de envío para Resend; **no envía nada** si no existe configuración.
- `backend/staging/auth-core.test.mjs`: pruebas SQLite en memoria; protege separación de clientes y cuentas.

**La migración 0002 todavía NO está aplicada a Cloudflare D1.** La migración 0001 se ejecutó manualmente en Studio y no figura en el historial `d1_migrations`. Antes de aplicar 0002 hay que conciliar ese historial cuidadosamente en `daurel-staging` y verificar el esquema real; nunca trabajar sobre `daurel-db`. No ejecutar migraciones automáticamente al hacer push.

**No existen rutas públicas de login** por ahora. Se conectarán solo cuando estén listos envío, límites de intentos, almacenamiento/expiración de OTP, cookies HttpOnly/Secure/SameSite, revocación y comprobación de titularidad de cada expediente.

## Proveedor recomendado para comenzar: Resend

Documentación/página oficial: https://resend.com/

La opción gratuita consultada en noviembre de 2026 anuncia hasta **3000 correos/mes y 100/día**, suficiente para primeras pruebas; verificar las condiciones vigentes en Resend antes de adoptar el servicio.

Cloudflare Email Service ofrece envío a destinatarios arbitrarios en Workers Paid, por eso no asumimos que la solución de Cloudflare sea gratuita para clientes sin verificar.

Configuración prevista:
- dominio remitente propio en Resend: preferentemente un subdominio dedicado a email transaccional o `daurel.com.mx`, según registros DNS;
- remitente ilustrativo: `acceso@daurel.com.mx`, **solo después de verificar el dominio**;
- `RESEND_API_KEY` en Cloudflare Worker staging como tipo **Secret**, nunca en GitHub;
- `AUTH_EMAIL_FROM` en el Worker staging, nunca enviar correo desde dirección no verificada;
- clave de firma para OTP `AUTH_OTP_HMAC_SECRET` independiente de `STAGING_TEST_TOKEN`.

**Operación manual inicial sugerida:** entrar a Resend, registrar cuenta del proyecto y abrir **Domains** para comenzar a verificar el dominio. No cambiar DNS sin revisar los registros propuestos, porque existen servicios activos en `daurel.com.mx`.

## Puntos de seguridad antes de encender acceso real

- Evitar enumeración de correos por mensajes distintos al iniciar sesión.
- Desafíos expiran en 10 minutos, máximo cinco intentos, caducidad de sesión y revocación.
- Límites por IP y correo, sin confiar únicamente en rate limiting local.
- No poner códigos, cookies, tokens, correos ni claves en registros de aplicación o URLs.
- Registrar consentimiento y avisos aplicables; política de retención y eliminación.
- Acceso por recurso: cuenta -> relación válida -> party -> solicitud, nunca por folio solo.
- El profesional y el personal de DAUREL tendrán su propio modelo de permisos y conflictos.
- Revisión de sesiones/seguridad antes de entrar en producción.

El panel V1 continúa operativo y sin cambios.
