// DAUREL V2: identidad de operador de STAGING. Independiente de las cuentas de cliente.
// Primer alta: clave técnica + OTP por correo; accesos posteriores: solo OTP.
// Nunca concede permisos por tener la sesión /v2/client ni por coincidencia de email.
// Solo envía al correo fijo de pruebas. No utilizar con datos reales ni en producción.
import {json,authorizeDemo} from "./demo-api.js";
import {newOtp,otpHmac,timingSafeHexEqual,newSessionToken,tokenHash,normalizeEmail} from "./auth-core.js";
import {sendLoginCode} from "./email-provider.js";
import {teamSchemaReady} from "./operator-team.js";

const OWNER="daurelcontact@gmail.com";
const COOKIE="__Host-daurel_v2_operator";
const FOUR_HOURS=4*60*60*1000, TEN_MINUTES=10*60*1000;
const TABLES=["operator_memberships","operator_login_challenges","operator_sessions","operator_access_audit"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answer=(data,status=200,headers={})=>{
 const res=json(data,status);
 res.headers.set("Cache-Control","no-store");
 res.headers.set("X-Content-Type-Options","nosniff");
 res.headers.set("X-Robots-Tag","noindex,nofollow");
 for(const [k,v] of Object.entries(headers))res.headers.set(k,v);
 return res;
};
function originOK(request){
 const expected=new URL(request.url).origin;
 const origin=request.headers.get("Origin");
 // Un Origin explícito distinto NUNCA se acepta.
 if(origin!==null)return origin===expected;
 // Algunos navegadores/extensiones eliminan Origin de POST de mismo origen.
 // En ese caso exigir TAMBIÉN las señales del navegador y Referer exacto.
 if(request.headers.get("Sec-Fetch-Site")!=="same-origin")return false;
 const referer=request.headers.get("Referer");
 if(!referer)return false;
 try{return new URL(referer).origin===expected}catch{return false}
}
// Cloudflare puede representar un POST SIN contenido como un stream vacío
// en lugar de null. Aceptar ambos, o JSON {} explícito, pero ningún dato extra.
// El límite de 32 bytes evita leer cargas arbitrariamente grandes.
async function emptyPost(request){
 if(request.body===null)return true;
 const length=request.headers.get("Content-Length");
 if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>32))return false;
 const reader=request.body.getReader();
 const chunks=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>32){await reader.cancel();return false}
   chunks.push(value);
  }
 }catch{return false}
 const raw=new TextDecoder().decode(
  chunks.length===0?new Uint8Array(0):
  Uint8Array.from(chunks.flatMap(c=>Array.from(c)))
 ).trim();
 if(raw==="")return true;
 return (request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")&&raw==="{}";
}
function settingsOK(env){
 return env.ENVIRONMENT==="staging" &&
  typeof env.AUTH_OTP_HMAC_SECRET==="string"&&env.AUTH_OTP_HMAC_SECRET.length>=32 &&
  typeof env.RESEND_API_KEY==="string"&&env.RESEND_API_KEY.length>=10 &&
  env.AUTH_EMAIL_FROM==="acceso@daurel.com.mx";
}
function sessionCookie(token,age){
 return COOKIE+"="+token+"; Path=/; Max-Age="+age+"; HttpOnly; Secure; SameSite=Strict";
}
function requestToken(request){
 const cookies=request.headers.get("Cookie")||"";
 const value=/(?:^|;\s*)__Host-daurel_v2_operator=([A-Za-z0-9_-]{43})(?:;|$)/.exec(cookies);
 return value?.[1]||null;
}
function otpDigest(email,challengeId,code,env){
 // HMAC con separación de dominio; los OTP de clientes no son válidos aquí.
 return otpHmac(email,challengeId,code,env.AUTH_OTP_HMAC_SECRET+"|daurel-v2-operator");
}
function readBody(request){
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return Promise.resolve(null);
 return request.text().then(t=>{
  if(t.length>180)return null;
  try{return JSON.parse(t)}catch{return null}
 });
}
export async function operatorSchemaReady(env){
 const result=await env.DB.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('operator_memberships','operator_login_challenges','operator_sessions','operator_access_audit')"
 ).all();
 const found=new Set((result.results||[]).map(x=>x.name));
 return TABLES.every(x=>found.has(x));
}
export async function operatorEnrolled(env){
 const row=await env.DB.prepare("SELECT account_id FROM operator_memberships LIMIT 1").first();
 return Boolean(row);
}
export async function operatorIdentity(request,env,now=Date.now()){
 if(!await operatorSchemaReady(env))return null;
 const raw=requestToken(request);
 if(!raw)return null;
 const hash=await tokenHash(raw);
 const teamReady=await teamSchemaReady(env);
 // El propietario funciona incluso antes de instalar 0007.
 // Un colaborador solo utiliza correos previamente autorizados.
 const approved=teamReady
  ? "AND ((m.role='owner' AND ae.email_normalized='daurelcontact@gmail.com') "+
    "OR (m.role<>'owner' AND EXISTS(SELECT 1 FROM operator_approved_emails p "+
    "WHERE p.account_id=a.account_id AND p.email_normalized=ae.email_normalized)))"
  : "AND m.role='owner' AND ae.email_normalized='daurelcontact@gmail.com'";
 const row=await env.DB.prepare([
  "SELECT s.session_id,s.account_id,m.role,ae.email_normalized",
  "FROM operator_sessions s",
  "JOIN accounts a ON a.account_id=s.account_id",
  "JOIN operator_memberships m ON m.account_id=a.account_id",
  "JOIN account_emails ae ON ae.account_id=a.account_id",
  "WHERE s.token_sha256=? AND s.revoked_at IS NULL",
  "AND s.expires_at>? AND a.status='active'",
  "AND m.status='active' AND m.revoked_at IS NULL",
  "AND ae.verified_at IS NOT NULL",approved,"LIMIT 1",
 ].join(" ")).bind(hash,new Date(now).toISOString()).first();
 return row||null;
}
export async function operatorStatus(request,env,now=Date.now()){
 if(env.ENVIRONMENT!=="staging")return answer({success:false},403);
 const ready=await operatorSchemaReady(env);
 if(!ready)return answer({
  success:true,schema_ready:false,enrolled:false,authenticated:false,
  message:"Antes del acceso administrativo, instala la migración 0006 en daurel-staging.",
 });
 const enrolled=await operatorEnrolled(env);
 const who=await operatorIdentity(request,env,now);
 return answer({
  success:true,schema_ready:true,enrolled,
  authenticated:Boolean(who),role:who?.role||null,
  email:who?.email_normalized||null,
  message:who?"Sesión administrativa activa.":enrolled?"Accede con tu código de correo.":"Primera activación: clave técnica y código de correo.",
 });
}
// La cuenta propietaria conserva inicio sin campo email; colaboradores deben
// proporcionar el correo exacto que el propietario aprobó previamente.
async function readStartEmail(request,bootstrap){
 if(request.body===null)return OWNER;
 const length=request.headers.get("Content-Length");
 if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>180))return null;
 const raw=await request.text();
 if(raw.trim()==="")return OWNER;
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return null;
 let data;
 try{data=JSON.parse(raw)}catch{return null}
 if(!data||typeof data!=="object"||Array.isArray(data))return null;
 const keys=Object.keys(data);
 if(keys.length===0)return length!==null&&Number(length)>32?null:OWNER;
 if(!bootstrap&&keys.length===1&&keys[0]==="email")return normalizeEmail(data.email);
 return null;
}
async function reserveOTP(env,now,email){
 // Límite individual: una solicitud por minuto y seis por día.
 // La clave del rate-limit NO contiene el correo en texto claro.
 const bytes=await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode("daurel-v2-operator-rate:"+email));
 const fingerprint=Array.from(new Uint8Array(bytes),
  x=>x.toString(16).padStart(2,"0")).join("");
 const day=String(Math.floor(now/86400000)),minute=String(Math.floor(now/60000));
 const daily=await env.DB.prepare([
  "INSERT INTO auth_rate_limits(subject_hash,window_start,attempts)",
  "VALUES(?,?,1)",
  "ON CONFLICT(subject_hash,window_start) DO UPDATE SET attempts=attempts+1",
  "WHERE attempts<6",
 ].join(" ")).bind("op-day-"+fingerprint,day).run();
 if(daily.meta?.changes!==1)return false;
 const perMinute=await env.DB.prepare([
  "INSERT OR IGNORE INTO auth_rate_limits(subject_hash,window_start,attempts)",
  "VALUES(?,?,1)",
 ].join(" ")).bind("op-minute-"+fingerprint,minute).run();
 return perMinute.meta?.changes===1;
}
export async function operatorStart(request,env,transport=fetch,now=Date.now()){
 if(!originOK(request))
  return answer({success:false,message:"Origen de la solicitud no permitido."},403);
 const bootstrap=new URL(request.url).pathname.endsWith("/setup/start");
 const email=await readStartEmail(request,bootstrap);
 if(!email)
  return answer({success:false,message:"Formato de solicitud incorrecto. Actualiza la página (Ctrl + F5)."},400);
 if(!settingsOK(env)||!await operatorSchemaReady(env))
  return answer({success:false,message:"El acceso administrativo aún no está configurado."},503);
 const enrolled=await operatorEnrolled(env);
 if(bootstrap){
  if(enrolled)return answer({success:false,message:"El administrador ya fue activado."},409);
  if(await authorizeDemo(request,env.STAGING_TEST_TOKEN)!=="authorized")
   return answer({success:false,message:"Clave técnica de primera activación incorrecta."},401);
 }else if(!enrolled){
  return answer({success:false,message:"Primero activa al administrador con clave técnica."},409);
 }else{
  const eligible=email===OWNER
   ?await operatorByEmail(env,email):await operatorApprovedByEmail(env,email);
  if(!eligible)return answer({success:false,message:"Este correo no está autorizado para operar DAUREL."},403);
 }
 if(!await reserveOTP(env,now,email))
  return answer({success:false,message:"Límite de correo de pruebas. Espera un minuto o revisa el cupo diario."},429);
 const code=newOtp(),challengeId=crypto.randomUUID(),purpose=bootstrap?"bootstrap":"login";
 const digest=await otpDigest(email,challengeId,code,env);
 await env.DB.prepare([
  "INSERT INTO operator_login_challenges(challenge_id,email_normalized,otp_hmac,purpose,expires_at)",
  "VALUES (?,?,?,?,?)",
 ].join(" ")).bind(
  challengeId,email,digest,purpose,new Date(now+TEN_MINUTES).toISOString(),
 ).run();
 await env.DB.prepare([
  "UPDATE operator_login_challenges SET consumed_at=CURRENT_TIMESTAMP",
  "WHERE challenge_id<>? AND email_normalized=? AND consumed_at IS NULL",
 ].join(" ")).bind(challengeId,email).run();
 try{
  const delivery=await sendLoginCode(email,code,challengeId,env,transport,"operator");
  if(!delivery.accepted)throw Error("mail not accepted");
 }catch{
  await env.DB.prepare("UPDATE operator_login_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE challenge_id=?")
   .bind(challengeId).run();
  return answer({success:false,message:"No pudo enviarse el código administrativo."},502);
 }
 return answer({
  success:true,challenge_id:challengeId,expires_in_seconds:600,
  message:"Código de seis dígitos enviado al correo de DAUREL.",
 },202);
}
async function operatorByEmail(env,email){
 return env.DB.prepare([
  "SELECT ae.account_id,m.role FROM account_emails ae",
  "JOIN accounts a ON a.account_id=ae.account_id",
  "JOIN operator_memberships m ON m.account_id=a.account_id",
  "WHERE ae.email_normalized=? AND a.status='active'",
  "AND m.status='active' AND m.revoked_at IS NULL",
  "AND (m.role<>'owner' OR ae.email_normalized='daurelcontact@gmail.com') LIMIT 1",
 ].join(" ")).bind(email).first();
}
async function operatorApprovedByEmail(env,email){
 if(!await teamSchemaReady(env))return null;
 return env.DB.prepare([
  "SELECT a.account_id,m.role FROM operator_approved_emails a",
  "JOIN operator_memberships m ON m.account_id=a.account_id",
  "JOIN accounts ac ON ac.account_id=a.account_id",
  "WHERE a.email_normalized=? AND m.status='active'",
  "AND m.role IN ('reader','manager')",
  "AND m.revoked_at IS NULL AND ac.status='active' LIMIT 1",
 ].join(" ")).bind(email).first();
}
async function createOwner(env){
 const existing=await env.DB.prepare(
  "SELECT account_id FROM account_emails WHERE email_normalized=?"
 ).bind(OWNER).first();
 let accountId=existing?.account_id;
 if(!accountId){
  const newId=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO accounts(account_id) VALUES (?)").bind(newId),
   env.DB.prepare([
    "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
    "VALUES (?,?,?,CURRENT_TIMESTAMP)",
   ].join(" ")).bind(crypto.randomUUID(),newId,OWNER),
  ]);
  accountId=newId;
 }
 const granted=await env.DB.prepare([
  "INSERT INTO operator_memberships(account_id,role)",
  "SELECT ?, 'owner' WHERE NOT EXISTS",
  "(SELECT 1 FROM operator_memberships)",
 ].join(" ")).bind(accountId).run();
 if(granted.meta?.changes!==1)throw Error("owner enrollment unavailable");
 await env.DB.prepare([
  "INSERT INTO operator_access_audit(audit_id,account_id,event_type)",
  "VALUES (?,?,'owner_enrolled')",
 ].join(" ")).bind(crypto.randomUUID(),accountId).run();
 return {account_id:accountId,role:"owner"};
}
export async function operatorVerify(request,env,now=Date.now()){
 if(!originOK(request))return answer({success:false,message:"Origen no permitido."},403);
 if(!settingsOK(env)||!await operatorSchemaReady(env))
  return answer({success:false,message:"Acceso administrativo no configurado."},503);
 const input=await readBody(request);
 if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).sort().join(",")!=="challenge_id,code"||
    !UUID.test(input.challenge_id)||typeof input.code!=="string"||!/^\d{6}$/.test(input.code))
  return answer({success:false,message:"Código incompleto o inválido."},400);
 const check=await env.DB.prepare([
  "SELECT email_normalized,purpose,otp_hmac FROM operator_login_challenges",
  "WHERE challenge_id=?",
 ].join(" ")).bind(input.challenge_id).first();
 if(!check)return answer({success:false,message:"Código no reconocido."},401);
 if(check.purpose==="bootstrap"){
  if(await authorizeDemo(request,env.STAGING_TEST_TOKEN)!=="authorized")
   return answer({success:false,message:"La primera activación requiere clave técnica."},401);
 }else if(check.purpose!=="login")return answer({success:false},401);
 const attempt=await env.DB.prepare([
  "UPDATE operator_login_challenges SET attempts=attempts+1",
  "WHERE challenge_id=? AND consumed_at IS NULL AND attempts<5",
  "AND expires_at>?",
 ].join(" ")).bind(input.challenge_id,new Date(now).toISOString()).run();
 if(attempt.meta?.changes!==1)return answer({success:false,message:"Código vencido o agotado."},401);
 const valid=await otpDigest(check.email_normalized,input.challenge_id,input.code,env);
 if(!timingSafeHexEqual(check.otp_hmac,valid))
  return answer({success:false,message:"Código incorrecto. Máximo cinco intentos."},401);
 const spent=await env.DB.prepare([
  "UPDATE operator_login_challenges SET consumed_at=CURRENT_TIMESTAMP",
  "WHERE challenge_id=? AND consumed_at IS NULL AND expires_at>?",
  "AND otp_hmac=? AND attempts<=5",
 ].join(" ")).bind(input.challenge_id,new Date(now).toISOString(),valid).run();
 if(spent.meta?.changes!==1)return answer({success:false,message:"Este código ya se utilizó."},401);
 let actor;
 if(check.purpose==="bootstrap"){
  if(await operatorEnrolled(env))return answer({success:false,message:"Cuenta administrativa ya activada."},409);
  try{actor=await createOwner(env)}catch{
   return answer({success:false,message:"No se pudo activar al administrador. Revisa la cuenta de pruebas."},409);
  }
 }else{
  if(check.email_normalized===OWNER){
   actor=await operatorByEmail(env,check.email_normalized);
  }else{
   actor=await operatorApprovedByEmail(env,check.email_normalized);
   if(actor){
    // Vincular correo a su cuenta solo AHORA, tras demostrar posesión del OTP.
    // verified_at es NOT NULL: nunca insertar un "correo pendiente" falso.
    const prior=await env.DB.prepare(
     "SELECT account_id FROM account_emails WHERE email_normalized=? LIMIT 1"
    ).bind(check.email_normalized).first();
    if(prior&&prior.account_id!==actor.account_id)
     return answer({success:false,message:"Correo vinculado a otra cuenta. Requiere revisión."},409);
    if(!prior){
     try{
      await env.DB.prepare([
       "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
       "VALUES (?,?,?,CURRENT_TIMESTAMP)",
      ].join(" ")).bind(crypto.randomUUID(),actor.account_id,check.email_normalized).run();
     }catch{
      return answer({success:false,message:"No se pudo verificar el correo. Solicita un nuevo código."},409);
     }
    }
   }
  }
  if(!actor)return answer({success:false,message:"La cuenta no tiene permisos administrativos."},403);
 }
 // El email se considera verificado solamente DESPUÉS de probar el OTP.
 await env.DB.prepare([
  "UPDATE account_emails SET verified_at=COALESCE(verified_at,CURRENT_TIMESTAMP)",
  "WHERE account_id=? AND email_normalized=?",
 ].join(" ")).bind(actor.account_id,check.email_normalized).run();
 const token=newSessionToken(),hash=await tokenHash(token);
 await env.DB.batch([
  env.DB.prepare([
   "INSERT INTO operator_sessions(session_id,account_id,token_sha256,expires_at)",
   "VALUES (?,?,?,?)",
  ].join(" ")).bind(crypto.randomUUID(),actor.account_id,hash,new Date(now+FOUR_HOURS).toISOString()),
  env.DB.prepare([
   "INSERT INTO operator_access_audit(audit_id,account_id,event_type)",
   "VALUES (?,?,'operator_login')",
  ].join(" ")).bind(crypto.randomUUID(),actor.account_id),
 ]);
 return answer({
  success:true,authenticated:true,role:actor.role,
  message:"Administrador verificado. Ya puedes gestionar DAUREL V2.",
 },200,{"Set-Cookie":sessionCookie(token,4*60*60)});
}
export async function operatorLogout(request,env,now=Date.now()){
 if(!originOK(request))
  return answer({success:false,message:"Origen de la solicitud no permitido."},403);
 if(!await emptyPost(request))
  return answer({success:false,message:"Formato de solicitud incorrecto. Actualiza la página (Ctrl + F5)."},400);
 const actor=await operatorIdentity(request,env,now);
 if(actor){
  await env.DB.batch([
   env.DB.prepare([
    "UPDATE operator_sessions SET revoked_at=CURRENT_TIMESTAMP",
    "WHERE session_id=? AND revoked_at IS NULL",
   ].join(" ")).bind(actor.session_id),
   env.DB.prepare([
    "INSERT INTO operator_access_audit(audit_id,account_id,event_type)",
    "VALUES (?,?,'operator_logout')",
   ].join(" ")).bind(crypto.randomUUID(),actor.account_id),
  ]);
 }
 return answer({success:true,authenticated:false,message:"Sesión administrativa cerrada."},
  200,{"Set-Cookie":sessionCookie("",0)});
}
export function roleAllows(role,path,method){
 // La bitácora de acciones de terceros está reservada para propietario.
 if(path==="/v2/operator/api/audit")return role==="owner"&&method==="GET";
 if(path==="/v2/operator/api/routing")return role==="owner"&&method==="GET";
 if(path==="/v2/operator/api/professionals/list")return role==="owner"&&method==="GET";
 if(path==="/v2/operator/api/professionals/save")return role==="owner"&&method==="POST";
 if(path==="/v2/operator/api/professionals/identity/list")return role==="owner"&&method==="GET";
 if(path==="/v2/operator/api/professionals/identity/save")return role==="owner"&&method==="POST";
 if(path.startsWith("/v2/operator/api/team/"))
  return role==="owner"&&(method==="GET"||method==="POST");
 if(path.startsWith("/v2/operator/api/assignments/"))
  return role==="owner"&&(method==="GET"||method==="POST");
 if(path==="/v2/operator/api/client-access/revoke")
  return role==="owner"&&method==="POST";
 if(role==="owner")return true;
 const readOnly=method==="GET" && [
  "/v2/operator/api/queue","/v2/operator/api/actions",
  "/v2/operator/api/followups",
 ].includes(path);
 if(role==="reader")return readOnly||method==="GET"&&
  /^\/v2\/operator\/api\/history\/[0-9a-f-]{36}$/i.test(path);
 if(role==="manager"){
  if(readOnly||method==="GET"&&
     /^\/v2\/operator\/api\/history\/[0-9a-f-]{36}$/i.test(path))return true;
  return method==="POST"&&[
   "/v2/operator/api/status","/v2/operator/api/record",
   "/v2/operator/api/followups/create",
   "/v2/operator/api/followups/complete",
   "/v2/operator/api/followups/cancel",
  ].includes(path);
 }
 return false;
}
export async function auditOperatorOperation(env,actor,method,path){
 if(!actor||method==="GET")return;
 await env.DB.prepare([
  "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation)",
  "VALUES (?,?,'operator_action',?)",
 ].join(" ")).bind(crypto.randomUUID(),actor.account_id,method+" "+path.slice(0,110)).run();
}
