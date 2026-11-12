// DAUREL V2: OTP para direcciones de prueba individuales (nunca clientes reales).
// Requiere flag, lista permitida, Turnstile, cuotas por IP y correo.
import {json} from "./demo-api.js";
import {newOtp,otpHmac,timingSafeHexEqual,newSessionToken,tokenHash,normalizeEmail} from "./auth-core.js";
import {sendLoginCode} from "./email-provider.js";
import {clientEmailPilotEnabled,allowedTestEmail} from "./client-email-pilot-config.js";

const OTP_TTL=10*60*1000;
const SESSION_TTL=8*60*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOKIE="__Host-daurel_v2_pilot";
function reply(body,status=200,cookie=null){
 const r=json(body,status);
 r.headers.set("X-Robots-Tag","noindex,nofollow");
 if(cookie!==null)r.headers.set("Set-Cookie",COOKIE+"="+cookie+"; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict");
 return r;
}
function sameOrigin(request){return request.headers.get("Origin")===new URL(request.url).origin}
async function jsonInput(request,expected,max=2300){
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))return null;
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>max)return null;
 let v;try{v=JSON.parse(raw)}catch{return null}
 if(!v||typeof v!=="object"||Array.isArray(v)||
   Object.keys(v).sort().join(",")!==expected.slice().sort().join(","))return null;
 return v;
}
async function sha(value){
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
 return Array.from(digest,v=>v.toString(16).padStart(2,"0")).join("");
}
async function reserve(db,subject,bucket,max){
 return (await db.prepare([
  "INSERT INTO auth_rate_limits(subject_hash,window_start,attempts) VALUES(?,?,1)",
  "ON CONFLICT(subject_hash,window_start) DO UPDATE SET attempts=attempts+1 WHERE attempts<?",
 ].join(" ")).bind(subject,bucket,max).run()).meta?.changes===1;
}
async function verifyTurnstile(request,env,token,transport){
 const ip=request.headers.get("CF-Connecting-IP");
 if(!ip||ip.length>64)return false;
 const body=new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:ip});
 const res=await transport("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString(),
 });
 if(!res.ok)return false;
 const result=await res.json();
 return result.success===true && result.action==="client_email_staging" &&
  result.hostname===new URL(request.url).hostname;
}
export async function startClientEmailPilot(request,env,transport=fetch,now=Date.now()){
 if(!clientEmailPilotEnabled(env))return reply({success:false,message:"Ensayo de correo individual no habilitado."},503);
 if(!sameOrigin(request))return reply({success:false,message:"Origen no permitido."},403);
 const v=await jsonInput(request,["email","turnstile_token"]);
 if(!v||!allowedTestEmail(env,v.email)||typeof v.turnstile_token!=="string"||
   v.turnstile_token.length<5||v.turnstile_token.length>2048)
  return reply({success:false,message:"Correo de ensayo o verificación inválidos."},400);
 const email=normalizeEmail(v.email);
 const ip=request.headers.get("CF-Connecting-IP");
 if(!ip||ip.length>64)return reply({success:false,message:"Origen no disponible."},403);
 let verified=false;
 try{verified=await verifyTurnstile(request,env,v.turnstile_token,transport)}catch{}
 if(!verified)return reply({success:false,message:"Verificación de seguridad inválida."},403);
 const day=String(Math.floor(now/86400000));
 const hashEmail=await sha(env.AUTH_OTP_HMAC_SECRET+"|email-pilot|"+email);
 const hashIp=await sha(env.AUTH_OTP_HMAC_SECRET+"|ip-pilot|"+ip);
 if(!await reserve(env.DB,"pilot-email-"+hashEmail,day,3))
  return reply({success:false,message:"Límite de correos de ensayo alcanzado."},429);
 if(!await reserve(env.DB,"pilot-ip-"+hashIp,day,8))
  return reply({success:false,message:"Límite de pruebas alcanzado en esta conexión."},429);
 if(!await reserve(env.DB,"pilot-global",day,20))
  return reply({success:false,message:"Límite global de pruebas alcanzado."},429);
 const challengeId=crypto.randomUUID(),code=newOtp();
 const digest=await otpHmac(email,challengeId,code,env.AUTH_OTP_HMAC_SECRET);
 const expiry=new Date(now+OTP_TTL).toISOString();
 await env.DB.prepare([
  "INSERT INTO login_challenges(challenge_id,email_normalized,otp_hmac,expires_at)",
  "VALUES(?,?,?,?)",
 ].join(" ")).bind(challengeId,email,digest,expiry).run();
 await env.DB.prepare([
  "UPDATE login_challenges SET consumed_at=CURRENT_TIMESTAMP",
  "WHERE email_normalized=? AND challenge_id<>? AND consumed_at IS NULL",
 ].join(" ")).bind(email,challengeId).run();
 let accepted=false;
 try{accepted=(await sendLoginCode(email,code,challengeId,env,transport)).accepted===true}catch{}
 if(!accepted){
  await env.DB.prepare("UPDATE login_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE challenge_id=?")
   .bind(challengeId).run();
  return reply({success:false,message:"No se pudo enviar el código de prueba."},502);
 }
 return reply({success:true,challenge_id:challengeId,
  recipient:email,expires_in_seconds:600,
  message:"Código enviado al correo de pruebas autorizado."},202);
}
export async function verifyClientEmailPilot(request,env,now=Date.now()){
 if(!clientEmailPilotEnabled(env))return reply({success:false,message:"Ensayo de correo individual no habilitado."},503);
 if(!sameOrigin(request))return reply({success:false,message:"Origen no permitido."},403);
 const v=await jsonInput(request,["challenge_id","code"],256);
 if(!v||typeof v.challenge_id!=="string"||!UUID.test(v.challenge_id)||
   typeof v.code!=="string"||!/^[0-9]{6}$/.test(v.code))
  return reply({success:false,message:"Código inválido."},400);
 const challenge=await env.DB.prepare([
  "SELECT email_normalized,otp_hmac FROM login_challenges",
  "WHERE challenge_id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5",
 ].join(" ")).bind(v.challenge_id,new Date(now).toISOString()).first();
 if(!challenge||!allowedTestEmail(env,challenge.email_normalized))
  return reply({success:false,message:"Código inválido o vencido."},401);
 const attempt=await env.DB.prepare([
  "UPDATE login_challenges SET attempts=attempts+1",
  "WHERE challenge_id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5",
 ].join(" ")).bind(v.challenge_id,new Date(now).toISOString()).run();
 if(attempt.meta?.changes!==1)return reply({success:false,message:"Código agotado."},401);
 const digest=await otpHmac(challenge.email_normalized,v.challenge_id,v.code,env.AUTH_OTP_HMAC_SECRET);
 if(!timingSafeHexEqual(challenge.otp_hmac,digest))
  return reply({success:false,message:"Código incorrecto."},401);
 const consumed=await env.DB.prepare([
  "UPDATE login_challenges SET consumed_at=CURRENT_TIMESTAMP",
  "WHERE challenge_id=? AND otp_hmac=? AND consumed_at IS NULL",
  "AND expires_at>? AND attempts<=5",
 ].join(" ")).bind(v.challenge_id,digest,new Date(now).toISOString()).run();
 if(consumed.meta?.changes!==1)return reply({success:false,message:"Código ya utilizado."},401);
 let row=await env.DB.prepare("SELECT account_id FROM account_emails WHERE email_normalized=?")
  .bind(challenge.email_normalized).first();
 if(!row){
  const id=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO accounts(account_id) VALUES (?)").bind(id),
   env.DB.prepare([
    "INSERT OR IGNORE INTO account_emails(email_id,account_id,email_normalized,verified_at)",
    "VALUES (?,?,?,CURRENT_TIMESTAMP)",
   ].join(" ")).bind(crypto.randomUUID(),id,challenge.email_normalized),
  ]);
  row=await env.DB.prepare("SELECT account_id FROM account_emails WHERE email_normalized=?")
   .bind(challenge.email_normalized).first();
 }
 if(!row)return reply({success:false,message:"No se pudo iniciar sesión."},503);
 const sessionToken=newSessionToken(),hash=await tokenHash(sessionToken);
 await env.DB.batch([
  env.DB.prepare([
   "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
   "VALUES (?,?,?,?)",
  ].join(" ")).bind(crypto.randomUUID(),row.account_id,hash,new Date(now+SESSION_TTL).toISOString()),
  env.DB.prepare("UPDATE accounts SET last_login_at=CURRENT_TIMESTAMP WHERE account_id=?")
   .bind(row.account_id),
  env.DB.prepare([
   "INSERT INTO account_access_audit(audit_id,account_id,event_type)",
   "VALUES (?,?,'session_created')",
  ].join(" ")).bind(crypto.randomUUID(),row.account_id),
 ]);
 return reply({success:true,authenticated:true,recipient:challenge.email_normalized,
  access_to_real_cases:false,message:"Correo individual de ensayo verificado."},200,sessionToken);
}
