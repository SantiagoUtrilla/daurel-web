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


// Únicamente prueba técnica de entrega: NO es un inicio de sesión y no genera OTP.
// Destinatario fijo. Se requiere STAGING_TEST_TOKEN y límite por minuto en el Worker.
export async function sendStagingTestEmail(env, minuteBucket, transport=fetch) {
  if (!env?.RESEND_API_KEY || typeof env.RESEND_API_KEY !== "string" ||
      !env?.AUTH_EMAIL_FROM || normalizeEmail(env.AUTH_EMAIL_FROM) !== "acceso@daurel.com.mx") {
    return {accepted:false,reason:"not_configured"};
  }
  if (!Number.isSafeInteger(minuteBucket) || minuteBucket < 0) {
    throw new TypeError("Ventana de prueba inválida");
  }
  const recipient="daurelcontact@gmail.com";
  const result=await transport("https://api.resend.com/emails", {
    method:"POST",
    headers:{
      "Authorization":"Bearer "+env.RESEND_API_KEY,
      "Content-Type":"application/json",
      "Idempotency-Key":"daurel-staging-delivery/"+minuteBucket,
      "User-Agent":"DAUREL-V2-staging/1.0",
    },
    body:JSON.stringify({
      from:"DAUREL <"+env.AUTH_EMAIL_FROM+">",
      to:[recipient],
      subject:"DAUREL V2 — Prueba de envío",
      text:"Este correo confirma que Resend puede enviar mensajes desde acceso@daurel.com.mx. "+
        "Es una prueba técnica; no contiene un código de inicio de sesión ni autoriza consultar expedientes.",
    }),
  });
  return result.ok ? {accepted:true,recipient} : {accepted:false,reason:"provider_rejected"};
}
