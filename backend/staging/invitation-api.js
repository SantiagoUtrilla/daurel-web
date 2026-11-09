// DAUREL V2 · Invitación de acceso a UN expediente ficticio. SOLO staging.
// El técnico puede enviar una invitación al correo fijo de DAUREL.
// El destinatario debe verificar su correo con OTP y presentar un código único.
// Ninguna ruta de este archivo consulta datos de producción.
import {json} from "./demo-api.js";
import {newSessionToken,tokenHash} from "./auth-core.js";
import {sessionRecord} from "./auth-pilot-api.js";

const TEST_EMAIL="daurelcontact@gmail.com";
const CHANNEL="daurel-v2-demo";
const TYPES=Object.freeze({
  laboral:"Solicitud ficticia: consulta laboral",
  civil:"Solicitud ficticia: asunto civil",
  marcas:"Solicitud ficticia: registro de marca",
  general:"Solicitud ficticia: orientación general",
});
const CONFIRM="emitir-invitacion-ficticia";
const TTL=24*60*60*1000;
const WINDOW=15*60*1000;
function out(data,status=200){
 const r=json(data,status);r.headers.set("X-Robots-Tag","noindex, nofollow");return r;
}
function sameOrigin(request){
 const origin=request.headers.get("Origin");
 return !origin||origin===new URL(request.url).origin;
}
async function input(request, max=256){
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")){
  throw new Error("Se requiere contenido JSON.");
 }
 const text=await request.text();
 if(new TextEncoder().encode(text).length>max)throw new Error("Contenido excesivo.");
 let value;try{value=JSON.parse(text)}catch{throw new Error("JSON inválido.")}
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Solicitud inválida.");
 return value;
}
async function ready(env){
 const result=await env.DB.prepare([
  "SELECT name FROM sqlite_master WHERE type='table'",
  "AND name IN ('case_invitations','account_request_access','case_access_audit')",
 ].join(" ")).all();
 return new Set((result.results||[]).map(x=>x.name)).size===3;
}
function emailReady(env){
 return typeof env.RESEND_API_KEY==="string"&&env.RESEND_API_KEY.length>=10&&
    env.AUTH_EMAIL_FROM==="acceso@daurel.com.mx";
}

export async function issuePilotInvite(request,env,transport=fetch,now=Date.now()){
 if(!sameOrigin(request))return out({success:false,message:"Origen no permitido."},403);
 if(!await ready(env))return out({success:false,message:"Falta instalar 0003_case_invitations.sql en daurel-staging."},503);
 if(!emailReady(env))return out({success:false,message:"Falta configurar el envío Resend en staging."},503);
 let data;
 try{data=await input(request)}catch(e){return out({success:false,message:e.message},400)}
 if(Object.keys(data).sort().join(",")!=="case_type,client_key,confirm"||
    typeof data.client_key!=="string"||!/^demo-[a-z0-9_-]{1,32}$/.test(data.client_key)||
    typeof data.case_type!=="string"||!Object.hasOwn(TYPES,data.case_type)||
    data.confirm!==CONFIRM){
   return out({success:false,message:"Indica un cliente y asunto ficticios y confirma la emisión."},400);
 }
 const matter=await env.DB.prepare([
  "SELECT sr.request_id,sr.public_folio",
  "FROM service_requests sr",
  "JOIN external_identities ei ON ei.party_id=sr.requester_party_id",
  "WHERE ei.channel_account_id=? AND ei.provider_user_id=?",
  "AND sr.summary=? AND sr.intake_channel='staging_demo'",
  "ORDER BY sr.opened_at DESC,sr.request_id DESC LIMIT 1",
 ].join(" ")).bind(CHANNEL,data.client_key,TYPES[data.case_type]).first();
 if(!matter)return out({success:false,message:"No existe ese asunto ficticio. Créalo primero en el laboratorio."},404);
 const code=newSessionToken();
 const hash=await tokenHash(code);
 const id=crypto.randomUUID();
 const bucket=String(Math.floor(now/WINDOW));
 try{
  await env.DB.prepare([
   "INSERT INTO case_invitations",
   "(invitation_id,request_id,intended_email,code_sha256,issue_bucket,expires_at)",
   "VALUES(?,?,?,?,?,?)",
  ].join(" ")).bind(
   id,matter.request_id,TEST_EMAIL,hash,bucket,new Date(now+TTL).toISOString()
  ).run();
 }catch(e){
  if(/UNIQUE|constraint failed/i.test(String(e))){
   return out({success:false,message:"Ya se emitió una invitación para este asunto. Espera 15 minutos."},429);
  }
  throw e;
 }

 try{
  const response=await transport("https://api.resend.com/emails",{
   method:"POST",
   headers:{
    Authorization:"Bearer "+env.RESEND_API_KEY,
    "Content-Type":"application/json",
    "Idempotency-Key":"daurel-v2-case-invite/"+id,
   },
   body:JSON.stringify({
    from:"DAUREL <"+env.AUTH_EMAIL_FROM+">",
    to:[TEST_EMAIL],
    subject:"DAUREL V2 — Invitación a consultar un asunto ficticio",
    text:[
     "Esta es una prueba técnica de invitación de acceso.",
     "Asunto ficticio: "+matter.public_folio,
     "Código de invitación (cópialo completo): "+code,
     "Caduca en 24 horas y solo puede utilizarse una vez.",
     "Para aceptarlo, inicia sesión con el código de correo de DAUREL y",
     "pega este código en el laboratorio de invitaciones.",
     "No compartas el código. No da acceso a expedientes reales.",
    ].join("\n"),
   }),
  });
  if(!response.ok)throw new Error("Provider rejected invitation");
 }catch{
  await env.DB.prepare(
   "UPDATE case_invitations SET revoked_at=CURRENT_TIMESTAMP WHERE invitation_id=?"
  ).bind(id).run();
  return out({success:false,message:"Resend no confirmó el envío. Comprueba su estado."},502);
 }
 await env.DB.batch([
  env.DB.prepare(
   "UPDATE case_invitations SET sent_at=CURRENT_TIMESTAMP WHERE invitation_id=?"
  ).bind(id),
  env.DB.prepare([
   "INSERT INTO case_access_audit(audit_id,request_id,invitation_id,event_type)",
   "VALUES(?,?,?,'invitation_sent')",
  ].join(" ")).bind(crypto.randomUUID(),matter.request_id,id),
 ]);
 return out({
  success:true,sent:true,public_folio:matter.public_folio,
  recipient:TEST_EMAIL,message:"Invitación de prueba enviada al correo DAUREL.",
  grants_real_access:false,
 },202);
}

export async function redeemPilotInvite(request,env,now=Date.now()){
 if(!sameOrigin(request))return out({success:false,message:"Origen no permitido."},403);
 if(!await ready(env))return out({success:false,message:"Falta instalar las tablas de invitaciones."},503);
 const s=await sessionRecord(request,env,now);
 if(!s||s.email_normalized!==TEST_EMAIL){
  return out({success:false,message:"Antes debes verificar tu correo en el laboratorio de acceso."},401);
 }
 let data;
 try{data=await input(request)}catch(e){return out({success:false,message:e.message},400)}
 if(Object.keys(data).join(",")!=="code"||typeof data.code!=="string"||
    !/^[A-Za-z0-9_-]{43}$/.test(data.code)){
  return out({success:false,message:"Introduce el código completo de invitación."},400);
 }
 const hash=await tokenHash(data.code);
 const auditId=crypto.randomUUID();
 const timestamp=new Date(now).toISOString();
 // D1 batch es atómico. Solo el primer canje puede marcar el código consumido.
 // Las inserciones de permisos dependen del registro consumido POR esta cuenta.
 const results=await env.DB.batch([
  env.DB.prepare([
   "UPDATE case_invitations SET redeemed_at=CURRENT_TIMESTAMP,redeemed_by_account_id=?",
   "WHERE code_sha256=? AND intended_email=? AND redeemed_at IS NULL",
   "AND revoked_at IS NULL AND sent_at IS NOT NULL AND expires_at>?",
   "AND EXISTS(SELECT 1 FROM service_requests sr",
   "WHERE sr.request_id=case_invitations.request_id AND sr.intake_channel='staging_demo')",
  ].join(" ")).bind(s.account_id,hash,s.email_normalized,timestamp),
  env.DB.prepare([
   "INSERT INTO account_request_access(account_id,request_id,permission,grant_basis)",
   "SELECT ?, ci.request_id,'view','case_invitation'",
   "FROM case_invitations ci",
   "WHERE ci.code_sha256=? AND ci.redeemed_by_account_id=? AND ci.redeemed_at IS NOT NULL",
   "ON CONFLICT(account_id,request_id) DO UPDATE SET",
   "permission='view',grant_basis='case_invitation',revoked_at=NULL",
  ].join(" ")).bind(s.account_id,hash,s.account_id),
  env.DB.prepare([
   "INSERT INTO case_access_audit(audit_id,request_id,account_id,invitation_id,event_type)",
   "SELECT ?,ci.request_id,?,ci.invitation_id,'invitation_redeemed'",
   "FROM case_invitations ci WHERE ci.code_sha256=?",
   "AND ci.redeemed_by_account_id=? AND ci.redeemed_at IS NOT NULL",
  ].join(" ")).bind(auditId,s.account_id,hash,s.account_id),
 ]);
 if(results?.[0]?.meta?.changes!==1){
  return out({success:false,message:"Invitación inválida, vencida o ya utilizada."},401);
 }
 return out({
  success:true,redeemed:true,grants_real_access:false,
  message:"Invitación aceptada. Solo se autorizó el asunto ficticio indicado.",
 },200);
}

export async function viewPilotInvitedMatters(request,env,now=Date.now()){
 if(!await ready(env))return out({success:false,message:"Falta instalar las tablas de invitaciones."},503);
 const s=await sessionRecord(request,env,now);
 if(!s||s.email_normalized!==TEST_EMAIL){
  return out({success:false,message:"Inicia sesión con tu código de correo."},401);
 }
 const res=await env.DB.prepare([
  "SELECT sr.request_id,sr.public_folio,sr.summary,sr.status,sr.opened_at",
  "FROM account_request_access ara",
  "JOIN service_requests sr ON sr.request_id=ara.request_id",
  "WHERE ara.account_id=? AND ara.revoked_at IS NULL",
  "AND sr.intake_channel='staging_demo'",
  "ORDER BY sr.opened_at DESC,sr.request_id DESC LIMIT 50",
 ].join(" ")).bind(s.account_id).all();
 const matters=res.results||[];
 return out({
  success:true,count:matters.length,matters,grants_real_access:false,
  message:matters.length?
   "Solo aparecen asuntos con una invitación aceptada y permiso vigente.":
   "No hay expedientes autorizados por invitación para esta cuenta.",
 });
}
