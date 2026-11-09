// DAUREL V2 — panel de vinculación explícita solo con datos ficticios.
// Todas las rutas protegidas por STAGING_TEST_TOKEN en worker.js y cookie de OTP.
// NO es un procedimiento de acreditación de identidad para clientes reales.
import {json} from "./demo-api.js";
import {sessionRecord} from "./auth-pilot-api.js";

const DEMO_CHANNEL="daurel-v2-demo";
const VALID_CLIENT=/^demo-[a-z0-9_-]{1,32}$/;
const CONFIRM_TEXT="confirmar-vinculo-ficticio";

function respond(data,status=200){
 const r=json(data,status);
 r.headers.set("X-Robots-Tag","noindex, nofollow");
 return r;
}
async function authed(request,env,now){
 const session=await sessionRecord(request,env,now);
 return session?.account_id||null;
}
function validOrigin(request){
 const origin=request.headers.get("Origin");
 return !origin || origin===new URL(request.url).origin;
}
async function body(request){
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")){
  throw Error("Debe enviarse JSON.");
 }
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>300)throw Error("Contenido demasiado grande.");
 let value;
 try {value=JSON.parse(raw)}catch{throw Error("JSON inválido.")}
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join(",")!=="client_key,confirm"||
    !VALID_CLIENT.test(value.client_key)||
    value.confirm!==CONFIRM_TEXT){
    throw Error("Confirma un cliente ficticio válido.");
 }
 return value.client_key;
}

export async function viewPilotAccount(request,env,now=Date.now()){
 const accountId=await authed(request,env,now);
 if(!accountId)return respond({success:false,message:"Inicia sesión por código antes de consultar tus asuntos."},401);
 const found=await env.DB.prepare([
   "SELECT ei.provider_user_id AS client_key, sr.request_id, sr.public_folio,",
   "sr.summary,sr.status,sr.opened_at",
   "FROM account_party_access aa",
   "JOIN parties p ON p.party_id=aa.party_id AND p.status='active'",
   "JOIN external_identities ei ON ei.party_id=p.party_id",
   "AND ei.channel_account_id=? AND ei.provider_user_id GLOB 'demo-*'",
   "JOIN service_requests sr ON sr.requester_party_id=p.party_id",
   "AND sr.intake_channel='staging_demo'",
   "WHERE aa.account_id=? AND aa.revoked_at IS NULL",
   "ORDER BY sr.opened_at DESC,sr.request_id DESC LIMIT 50",
 ].join(" ")).bind(DEMO_CHANNEL,accountId).all();
 const matters=found.results||[];
 return respond({
  success:true,environment:"staging",authenticated:true,
  matters,count:matters.length,
  message:matters.length?
    "Solo aparecen los expedientes ficticios expresamente vinculados con tu cuenta.":
    "Cuenta verificada sin expedientes vinculados. No se concede acceso automáticamente.",
  access_to_real_cases:false,
 });
}

export async function linkPilotClient(request,env,now=Date.now()){
 if(!validOrigin(request))return respond({success:false,message:"Origen no permitido."},403);
 const accountId=await authed(request,env,now);
 if(!accountId)return respond({success:false,message:"Primero verifica tu correo para crear una sesión."},401);
 let clientKey;
 try{clientKey=await body(request)}catch(e){
  return respond({success:false,message:e.message},400);
 }
 // Solo se puede asociar un registro creado por la fábrica de casos ficticios.
 const party=await env.DB.prepare([
  "SELECT ei.party_id",
  "FROM external_identities ei",
  "JOIN parties p ON p.party_id=ei.party_id AND p.status='active'",
  "WHERE ei.channel_account_id=? AND ei.provider_user_id=?",
  "AND EXISTS (SELECT 1 FROM service_requests sr WHERE sr.requester_party_id=ei.party_id",
  "AND sr.intake_channel='staging_demo') LIMIT 1",
 ].join(" ")).bind(DEMO_CHANNEL,clientKey).first();
 if(!party)return respond({success:false,message:"No existe ese cliente ficticio con solicitudes de pruebas."},404);

 // El operador confirma expresamente esta concesión, que puede revocarse.
 // No se infiere de coincidencias de emails, teléfonos o folios.
 await env.DB.prepare([
  "INSERT INTO account_party_access(account_id,party_id,permission,grant_basis)",
  "VALUES (?,?,'view_own','manual_review')",
  "ON CONFLICT(account_id,party_id) DO UPDATE SET",
  "permission='view_own',grant_basis='manual_review',revoked_at=NULL",
 ].join(" ")).bind(accountId,party.party_id).run();
 await env.DB.prepare([
  "INSERT INTO account_access_audit(audit_id,account_id,party_id,event_type)",
  "VALUES (?,?,?,'party_granted')",
 ].join(" ")).bind(crypto.randomUUID(),accountId,party.party_id).run();
 return respond({
  success:true,linked:true,client_key:clientKey,
  message:"Acceso al cliente ficticio concedido explícitamente en el laboratorio.",
  access_to_real_cases:false,
 });
}

export async function unlinkPilotClient(request,env,now=Date.now()){
 if(!validOrigin(request))return respond({success:false,message:"Origen no permitido."},403);
 const accountId=await authed(request,env,now);
 if(!accountId)return respond({success:false,message:"Inicia sesión primero."},401);
 let clientKey;
 try{clientKey=await body(request)}catch(e){
  return respond({success:false,message:e.message},400);
 }
 const result=await env.DB.prepare([
  "UPDATE account_party_access SET revoked_at=CURRENT_TIMESTAMP",
  "WHERE account_id=? AND revoked_at IS NULL",
  "AND party_id IN (SELECT ei.party_id FROM external_identities ei",
  "WHERE ei.channel_account_id=? AND ei.provider_user_id=?)",
 ].join(" ")).bind(accountId,DEMO_CHANNEL,clientKey).run();
 if(result.meta?.changes===1){
  const party=await env.DB.prepare([
   "SELECT party_id FROM external_identities WHERE channel_account_id=?",
   "AND provider_user_id=? LIMIT 1",
  ].join(" ")).bind(DEMO_CHANNEL,clientKey).first();
  await env.DB.prepare([
   "INSERT INTO account_access_audit(audit_id,account_id,party_id,event_type)",
   "VALUES (?,?,?,'party_revoked')",
  ].join(" ")).bind(crypto.randomUUID(),accountId,party.party_id).run();
 }
 return respond({
  success:true,unlinked:true,client_key:clientKey,
  message:"El permiso de consulta ficticio quedó revocado.",
  access_to_real_cases:false,
 });
}
