// DAUREL V2: piloto OTP restringido a la cuenta de pruebas de DAUREL.
// TODAS las rutas exigen STAGING_TEST_TOKEN en worker.js; ningún cliente público entra aquí.
// Nunca abre expedientes ni vincula personas automáticamente por coincidencia de correo.

import { json } from "./demo-api.js";
import {
  newOtp, otpHmac, timingSafeHexEqual, newSessionToken, tokenHash,
} from "./auth-core.js";
import { sendLoginCode } from "./email-provider.js";

const OWNER_EMAIL = "daurelcontact@gmail.com";
const SESSION_COOKIE = "__Host-daurel_v2_pilot";
const OTP_LIFETIME_MS = 10 * 60 * 1000;
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 5 * 60 * 1000;

function noStore(resp) {
  resp.headers.set("Cache-Control", "no-store");
  resp.headers.set("X-Content-Type-Options", "nosniff");
  return resp;
}
function reply(data, status = 200, headers = {}) {
  const r = json(data, status);
  Object.entries(headers).forEach(([k, v]) => r.headers.set(k, v));
  return noStore(r);
}
function configured(env) {
  return typeof env.AUTH_OTP_HMAC_SECRET === "string" &&
    env.AUTH_OTP_HMAC_SECRET.length >= 32 &&
    typeof env.RESEND_API_KEY === "string" &&
    env.RESEND_API_KEY.length >= 10 &&
    env.AUTH_EMAIL_FROM === "acceso@daurel.com.mx";
}
async function schemaReady(db) {
  const r = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN " +
    "('accounts','account_emails','login_challenges','account_sessions','auth_rate_limits','account_access_audit')"
  ).all();
  return new Set((r.results || []).map(x => x.name)).size === 6;
}
function originAllowed(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}
function validNoBody(request) {
  return request.headers.get("Content-Length") === null ||
    Number(request.headers.get("Content-Length")) === 0;
}
function parseCookie(request) {
  const value = request.headers.get("Cookie") || "";
  const match = /(?:^|;\s*)__Host-daurel_v2_pilot=([A-Za-z0-9_-]{43})(?:;|$)/.exec(value);
  return match ? match[1] : null;
}
function sessionCookie(token, maxAge) {
  return SESSION_COOKIE + "=" + token +
    "; Path=/; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Strict";
}
function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function bodyJson(request, maxBytes = 256) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    throw new Error("JSON requerido.");
  }
  return request.text().then(s => {
    if (new TextEncoder().encode(s).length > maxBytes) throw new Error("Contenido inválido.");
    try {return JSON.parse(s)} catch {throw new Error("JSON inválido.")}
  });
}

export async function startPilotLogin(request, env, transport = fetch, now = Date.now()) {
  if (!originAllowed(request) || !validNoBody(request)) {
    return reply({success:false,message:"Solicitud no permitida."},400);
  }
  if (!configured(env)) {
    return reply({success:false,message:"Falta configuración técnica de OTP en staging."},503);
  }
  if (!await schemaReady(env.DB)) {
    return reply({success:false,message:"Falta aplicar el esquema de cuentas 0002 en daurel-staging."},503);
  }

  // Reserva atómica: un correo como máximo por intervalo de 5 minutos.
  const bucket = String(Math.floor(now / RATE_WINDOW_MS));
  const rate = await env.DB.prepare([
    "INSERT OR IGNORE INTO auth_rate_limits(subject_hash,window_start,attempts)",
    "VALUES ('daurel-staging-owner-pilot', ?, 1)",
  ].join(" ")).bind(bucket).run();
  if (rate.meta?.changes !== 1) {
    return reply({success:false,message:"Ya se solicitó un código. Espera cinco minutos para otro."},429);
  }

  const code = newOtp();
  const challengeId = crypto.randomUUID();
  const digest = await otpHmac(OWNER_EMAIL, challengeId, code, env.AUTH_OTP_HMAC_SECRET);
  const expires = new Date(now + OTP_LIFETIME_MS).toISOString();
  await env.DB.prepare([
    "INSERT INTO login_challenges(challenge_id,email_normalized,otp_hmac,expires_at)",
    "VALUES (?,?,?,?)",
  ].join(" ")).bind(challengeId, OWNER_EMAIL, digest, expires).run();

  // Invalidar desafíos anteriores; solo el último envío será válido.
  await env.DB.prepare([
    "UPDATE login_challenges SET consumed_at=CURRENT_TIMESTAMP",
    "WHERE email_normalized=? AND challenge_id<>? AND consumed_at IS NULL",
  ].join(" ")).bind(OWNER_EMAIL, challengeId).run();

  try {
    const delivery = await sendLoginCode(OWNER_EMAIL, code, challengeId, env, transport);
    if (!delivery.accepted) {
      await env.DB.prepare(
        "UPDATE login_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE challenge_id=?"
      ).bind(challengeId).run();
      return reply({success:false,message:"El proveedor no confirmó el envío del código."},502);
    }
  } catch {
    await env.DB.prepare(
      "UPDATE login_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE challenge_id=?"
    ).bind(challengeId).run();
    return reply({success:false,message:"No se pudo confirmar el envío del código."},502);
  }
  return reply({
    success:true,
    challenge_id:challengeId,
    delivery:"accepted",
    expires_in_seconds:600,
    recipient:"daurelcontact@gmail.com",
    message:"Código enviado al correo de pruebas. No es un acceso de clientes.",
  },202);
}

export async function verifyPilotLogin(request, env, now = Date.now()) {
  if (!originAllowed(request)) return reply({success:false,message:"Origen no autorizado."},403);
  if (!configured(env) || !await schemaReady(env.DB)) {
    return reply({success:false,message:"Inicio de sesión de pruebas no configurado."},503);
  }
  let data;
  try {data = await bodyJson(request)} catch {
    return reply({success:false,message:"Solicitud inválida."},400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(k=>!["challenge_id","code"].includes(k)) ||
      !isUuid(data.challenge_id) || typeof data.code !== "string" ||
      !/^\d{6}$/.test(data.code)) {
    return reply({success:false,message:"Código o solicitud inválida."},400);
  }

  // El UPDATE cuenta intentos de forma atómica y rechaza códigos gastados.
  const attempt = await env.DB.prepare([
    "UPDATE login_challenges SET attempts=attempts+1",
    "WHERE challenge_id=? AND email_normalized=? AND consumed_at IS NULL",
    "AND attempts<5 AND expires_at>?",
  ].join(" ")).bind(data.challenge_id,OWNER_EMAIL,new Date(now).toISOString()).run();
  if (attempt.meta?.changes!==1) {
    return reply({success:false,message:"Código vencido, agotado o utilizado."},401);
  }
  const challenge = await env.DB.prepare(
    "SELECT otp_hmac FROM login_challenges WHERE challenge_id=?"
  ).bind(data.challenge_id).first();
  const digest = await otpHmac(OWNER_EMAIL,data.challenge_id,data.code,env.AUTH_OTP_HMAC_SECRET);
  if (!challenge || !timingSafeHexEqual(challenge.otp_hmac,digest)) {
    return reply({success:false,message:"Código incorrecto. Máximo cinco intentos."},401);
  }

  // Una única verificación consume el código, incluso en peticiones simultáneas.
  const spent = await env.DB.prepare([
    "UPDATE login_challenges SET consumed_at=CURRENT_TIMESTAMP",
    "WHERE challenge_id=? AND email_normalized=? AND consumed_at IS NULL",
    "AND expires_at>? AND otp_hmac=? AND attempts<=5",
  ].join(" ")).bind(data.challenge_id,OWNER_EMAIL,new Date(now).toISOString(),digest).run();
  if (spent.meta?.changes!==1) {
    return reply({success:false,message:"Este código ya se utilizó."},401);
  }

  let emailAccount = await env.DB.prepare(
    "SELECT account_id FROM account_emails WHERE email_normalized=?"
  ).bind(OWNER_EMAIL).first();
  if (!emailAccount) {
    const accountId=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO accounts(account_id) VALUES (?)").bind(accountId),
      env.DB.prepare([
        "INSERT OR IGNORE INTO account_emails(email_id,account_id,email_normalized,verified_at)",
        "VALUES (?,?,?,CURRENT_TIMESTAMP)",
      ].join(" ")).bind(crypto.randomUUID(),accountId,OWNER_EMAIL),
    ]);
    emailAccount = await env.DB.prepare(
      "SELECT account_id FROM account_emails WHERE email_normalized=?"
    ).bind(OWNER_EMAIL).first();
  }
  if (!emailAccount) {
    return reply({success:false,message:"No se pudo completar la cuenta de pruebas."},503);
  }
  const token = newSessionToken();
  const sessionId = crypto.randomUUID();
  const hashed = await tokenHash(token);
  const expiry = new Date(now + SESSION_LIFETIME_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at) VALUES (?,?,?,?)"
    ).bind(sessionId,emailAccount.account_id,hashed,expiry),
    env.DB.prepare("UPDATE accounts SET last_login_at=CURRENT_TIMESTAMP WHERE account_id=?")
      .bind(emailAccount.account_id),
    env.DB.prepare(
      "INSERT INTO account_access_audit(audit_id,account_id,event_type) VALUES (?,?,'session_created')"
    ).bind(crypto.randomUUID(),emailAccount.account_id),
  ]);

  return reply({
    success:true, authenticated:true, recipient:OWNER_EMAIL,
    message:"Correo verificado. Sesión de prueba creada sin contraseña.",
    access_to_real_cases:false,
  },200,{"Set-Cookie":sessionCookie(token,8*60*60)});
}

async function sessionRecord(request,env,now) {
  const token=parseCookie(request);
  if (!token) return null;
  const hashed=await tokenHash(token);
  const row=await env.DB.prepare([
    "SELECT s.session_id,s.account_id,ae.email_normalized",
    "FROM account_sessions s JOIN accounts a ON a.account_id=s.account_id",
    "JOIN account_emails ae ON ae.account_id=a.account_id",
    "WHERE s.token_sha256=? AND s.revoked_at IS NULL AND s.expires_at>?",
    "AND a.status='active' AND ae.email_normalized=? LIMIT 1",
  ].join(" ")).bind(hashed,new Date(now).toISOString(),OWNER_EMAIL).first();
  return row || null;
}

export async function getPilotSession(request,env,now=Date.now()) {
  if (!await schemaReady(env.DB)) {
    return reply({success:false,message:"Falta configurar cuentas de staging."},503);
  }
  const s=await sessionRecord(request,env,now);
  return reply(s ? {
    success:true,authenticated:true,
    recipient:s.email_normalized,account_id:s.account_id,
    access_to_real_cases:false,
  } : {success:true,authenticated:false,access_to_real_cases:false});
}

export async function logoutPilotSession(request,env,now=Date.now()) {
  if (!originAllowed(request) || !validNoBody(request)) {
    return reply({success:false,message:"Solicitud no permitida."},400);
  }
  if (!await schemaReady(env.DB)) {
    return reply({success:false,message:"Falta configurar cuentas de staging."},503);
  }
  const s=await sessionRecord(request,env,now);
  if (s) await env.DB.prepare(
    "UPDATE account_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_id=? AND revoked_at IS NULL"
  ).bind(s.session_id).run();
  return reply({success:true,authenticated:false,message:"Sesión de pruebas cerrada."},
    200,{"Set-Cookie":sessionCookie("",0)});
}
