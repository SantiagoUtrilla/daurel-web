// DAUREL V2 — nombres ficticios y requisitos de incorporación profesional.
// SOLO en staging, propietario. No almacenar documentos de identidad en D1,
// no registrar datos reales en el laboratorio y nunca marcar un requisito
// como "aprobado" sin un flujo separado, autenticado y auditable.
import {json} from "./demo-api.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REQUIREMENT_LABELS=Object.freeze({
 professional_license:"Cédula profesional y habilitación aplicable",
 identity_check:"Verificación de identidad (INE u otro medio adecuado)",
 contract:"Contrato de colaboración",
 terms:"Aceptación de términos vigentes",
 privacy_notice:"Constancia del aviso de privacidad",
});
const REQ_CODES=Object.keys(REQUIREMENT_LABELS);
const NAME=/^[\p{L}\p{M}][\p{L}\p{M} .'-]{2,119}$/u;

function reply(obj,status=200){
 const res=json(obj,status);
 res.headers.set("Cache-Control","no-store");
 res.headers.set("X-Robots-Tag","noindex,nofollow");
 return res;
}
function allowed(env,actor){
 return env?.ENVIRONMENT==="staging"&&actor?.role==="owner"&&!!actor.account_id;
}
export async function identitySchemaReady(env){
 const r=await env.DB.prepare([
  "SELECT name FROM sqlite_master WHERE type='table'",
  "AND name IN ('operator_professional_identities','operator_professional_requirements')",
 ].join(" ")).all();
 return new Set((r.results||[]).map(row=>row.name)).size===2;
}
export async function listProfessionalIdentities(env,actor){
 if(!allowed(env,actor))
  return reply({success:false,message:"Solo la cuenta propietaria puede consultar identidades profesionales."},403);
 if(!await identitySchemaReady(env))
  return reply({success:false,schema_ready:false,
   message:"Primero ejecuta la migración 0009 en daurel-staging."},503);
 const rows=await env.DB.prepare([
  "SELECT a.account_id,a.email_normalized AS email,",
  "COALESCE(p.full_name,'') AS full_name,",
  "req.requirement_code,req.status",
  "FROM operator_approved_emails a",
  "JOIN operator_memberships m ON m.account_id=a.account_id",
  "LEFT JOIN operator_professional_identities p ON p.account_id=a.account_id",
  "LEFT JOIN operator_professional_requirements req ON req.account_id=a.account_id",
  "WHERE m.role IN ('reader','manager') ORDER BY a.email_normalized,req.requirement_code LIMIT 120",
 ].join(" ")).all();
 const ids=new Map();
 for(const row of rows.results||[]){
  if(!ids.has(row.account_id)){
   ids.set(row.account_id,{
    account_id:row.account_id,email:row.email,
    full_name:row.full_name,identity_name_recorded:!!row.full_name,
    onboarding:Object.fromEntries(REQ_CODES.map(code=>[code,"not_collected"])),
    credentials_verified:false,
   });
  }
  if(row.requirement_code&&Object.hasOwn(REQUIREMENT_LABELS,row.requirement_code))
   ids.get(row.account_id).onboarding[row.requirement_code]=row.status;
 }
 return reply({
  success:true,synthetic_only:true,
  document_uploads_enabled:false,automatic_assignment_enabled:false,
  requirements:REQUIREMENT_LABELS,identities:[...ids.values()],
  notice:"Solo nombres ficticios. Requisitos no verificados; NO subir cédula, INE, contratos ni firmas.",
 });
}
export async function saveProfessionalIdentity(request,env,actor){
 if(!allowed(env,actor))
  return reply({success:false,message:"Solo la cuenta propietaria puede editar la identidad profesional."},403);
 if(!await identitySchemaReady(env))
  return reply({success:false,message:"Primero instala la migración 0009 en daurel-staging."},503);
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return reply({success:false,message:"Origen no permitido."},403);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return reply({success:false,message:"Se requiere JSON."},415);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>450)
  return reply({success:false,message:"Solicitud demasiado grande."},413);
 let data;try{data=JSON.parse(raw)}catch{return reply({success:false,message:"Datos inválidos."},400)}
 if(!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).sort().join(",")!=="account_id,full_name"||
    typeof data.account_id!=="string"||!UUID.test(data.account_id)||
    data.account_id===actor.account_id||
    typeof data.full_name!=="string")
  return reply({success:false,message:"Identificador o nombre inválido."},400);
 const fullName=data.full_name.trim().replace(/\s+/g," ");
 if(!NAME.test(fullName)||/ {2,}/.test(fullName))
  return reply({success:false,message:"Escribe un nombre ficticio de 3 a 120 caracteres, sin números ni símbolos especiales."},400);
 const member=await env.DB.prepare([
  "SELECT m.account_id FROM operator_memberships m",
  "JOIN operator_approved_emails e ON e.account_id=m.account_id",
  "WHERE m.account_id=? AND m.role IN ('reader','manager') LIMIT 1",
 ].join(" ")).bind(data.account_id).first();
 if(!member)
  return reply({success:false,message:"El colaborador no existe o no está autorizado."},404);
 const current=await env.DB.prepare([
  "SELECT full_name FROM operator_professional_identities WHERE account_id=?",
 ].join(" ")).bind(data.account_id).first();
 if(current?.full_name===fullName)
  return reply({success:true,replayed:true,full_name:fullName,
   message:"El nombre ya estaba registrado."},200);
 const steps=[
  env.DB.prepare([
   "INSERT INTO operator_professional_identities",
   "(account_id,full_name,updated_by_account_id) VALUES (?,?,?)",
   "ON CONFLICT(account_id) DO UPDATE SET",
   "full_name=excluded.full_name,updated_by_account_id=excluded.updated_by_account_id,",
   "updated_at=CURRENT_TIMESTAMP",
  ].join(" ")).bind(data.account_id,fullName,actor.account_id),
 ];
 for(const code of REQ_CODES){
  steps.push(env.DB.prepare([
   "INSERT OR IGNORE INTO operator_professional_requirements",
   "(account_id,requirement_code,status) VALUES (?,?,'not_collected')",
  ].join(" ")).bind(data.account_id,code));
 }
 steps.push(env.DB.prepare([
  "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation)",
  "VALUES (?,?,'operator_action',?)",
 ].join(" ")).bind(crypto.randomUUID(),actor.account_id,"PROFESSIONAL_IDENTITY_UPDATED "+data.account_id));
 await env.DB.batch(steps);
 return reply({success:true,full_name:fullName,synthetic_only:true,
  credentials_verified:false,
  message:"Nombre ficticio guardado. Los cinco requisitos permanecen sin verificar."});
}
