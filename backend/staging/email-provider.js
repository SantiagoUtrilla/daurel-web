// DAUREL V2 - transporte transaccional de códigos OTP (Resend).
// No está montado en rutas públicas. Requiere dominio de envío verificado.
// Los secretos RESEND_API_KEY y AUTH_EMAIL_FROM se configuran solo en staging.

import { normalizeEmail } from "./auth-core.js";

export async function sendLoginCode(to, code, challengeId, env, transport=fetch) {
  const email = normalizeEmail(to);
  if (!email || !/^\d{6}$/.test(code) ||
      !/^[0-9a-f-]{36}$/i.test(challengeId)) {
    throw new TypeError("Solicitud de envío inválida");
  }
  if (!env?.RESEND_API_KEY || typeof env.RESEND_API_KEY!=="string" ||
      !env?.AUTH_EMAIL_FROM || !normalizeEmail(env.AUTH_EMAIL_FROM)) {
    return { accepted: false, reason: "not_configured" };
  }
  const payload={
    from: "DAUREL <"+env.AUTH_EMAIL_FROM+">",
    to: [email],
    subject: "Tu código de acceso a DAUREL",
    text: [
      "Tu código temporal es: "+code,
      "Caduca en 10 minutos.",
      "Si no solicitaste acceso a DAUREL, puedes ignorar este mensaje.",
      "Nunca compartas este código.",
    ].join("\n"),
  };
  const res = await transport("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer "+env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "daurel-login/"+challengeId,
    },
    body: JSON.stringify(payload),
  });
  if(!res.ok) return {accepted:false,reason:"provider_rejected"};
  // No devolver el código ni datos de la API de correo al cliente.
  return {accepted:true};
}
