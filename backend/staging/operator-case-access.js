// DAUREL V2 · Permisos por expediente para cada colaborador (solo staging).
// El rol global no concede lectura de expedientes ajenos. El propietario ve todo.
// Mismo archivo 0007 que guarda autorizaciones de correo para evitar más pasos D1.
import {json} from "./demo-api.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function respond(data,status=200){
 const r=json(data,status);r.headers.set("Cache-Control","no-store");return r;
}
function owner(env,actor){return env.ENVIRONMENT==="staging"&&actor?.role==="owner"}
export async function caseAccessSchemaReady(env){
 const r=await env.DB.prepare([
  "SELECT 1 AS ok FROM sqlite_master WHERE type='table'",
  "AND name='operator_case_assignments' LIMIT 1",
 ].join(" ")).first();
 return r?.ok===1;
}
export async function assignedCase(env,actor,requestId){
 if(!actor)return false;
 if(actor.role==="owner")return true;
 if(!UUID.test(requestId)||!await caseAccessSchemaReady(env))return false;
 const r=await env.DB.prepare([
  "SELECT 1 AS ok FROM operator_case_assignments ca",
  "JOIN service_requests sr ON sr.request_id=ca.request_id",
  "WHERE ca.account_id=? AND ca.request_id=?",
  "AND ca.revoked_at IS NULL AND sr.intake_channel='staging_demo'",
  "LIMIT 1",
 ].join(" ")).bind(actor.account_id,requestId).first();
 return r?.ok===1;
}
export async function listCaseAssignments(env,actor){
 if(!owner(env,actor))return respond({success:false,message:"Solo el propietario puede gestionar las asignaciones."},403);
 if(!await caseAccessSchemaReady(env))
  return respond({success:false,message:"Falta la tabla de permisos por asunto de la migración 0007."},503);
 const r=await env.DB.prepare([
  "SELECT ca.account_id,ca.request_id,ca.assigned_at,",
  "ae.email_normalized AS email,sr.public_folio",
  "FROM operator_case_assignments ca",
  "JOIN service_requests sr ON sr.request_id=ca.request_id",
  "JOIN operator_approved_emails ae ON ae.account_id=ca.account_id",
  "WHERE ca.revoked_at IS NULL AND sr.intake_channel='staging_demo'",
  "ORDER BY sr.public_folio,ae.email_normalized LIMIT 500",
 ].join(" ")).all();
 return respond({success:true,assignments:r.results||[],synthetic_only:true});
}
export async function changeCaseAssignment(request,env,actor){
 if(!owner(env,actor))return respond({success:false,message:"Solo el propietario puede asignar expedientes."},403);
 if(!await caseAccessSchemaReady(env))
  return respond({success:false,message:"Falta instalar el esquema 0007 en daurel-staging."},503);
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return respond({success:false,message:"Origen no permitido."},403);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return respond({success:false,message:"Formato JSON requerido."},415);
 const raw=await request.text();
 if(raw.length>220)return respond({success:false,message:"Solicitud excesiva."},413);
 let data;
 try{data=JSON.parse(raw)}catch{return respond({success:false,message:"Solicitud inválida."},400)}
 if(!data||typeof data!=="object"||Array.isArray(data)||
  Object.keys(data).sort().join(",")!=="account_id,allow,request_id"||
  !UUID.test(data.account_id)||!UUID.test(data.request_id)||
  typeof data.allow!=="boolean"||data.account_id===actor.account_id)
  return respond({success:false,message:"Colaborador y expediente válidos requeridos."},400);
 const member=await env.DB.prepare([
  "SELECT m.account_id,m.status FROM operator_memberships m",
  "JOIN operator_approved_emails e ON e.account_id=m.account_id",
  "WHERE m.account_id=? AND m.role IN ('reader','manager') LIMIT 1",
 ].join(" ")).bind(data.account_id).first();
 if(!member)return respond({success:false,message:"Colaborador no encontrado."},404);
 if(data.allow&&member.status!=="active")
  return respond({success:false,message:"No puedes asignar un expediente a un colaborador desactivado."},409);
 const matter=await env.DB.prepare([
  "SELECT request_id FROM service_requests WHERE request_id=?",
  "AND intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(data.request_id).first();
 if(!matter)return respond({success:false,message:"Expediente de pruebas no encontrado."},404);
 const current=await env.DB.prepare([
  "SELECT revoked_at FROM operator_case_assignments",
  "WHERE account_id=? AND request_id=?",
 ].join(" ")).bind(data.account_id,data.request_id).first();
 if(data.allow&&current?.revoked_at===null ||
    !data.allow&&(!current||current.revoked_at!==null)){
  return respond({success:true,replayed:true,message:"La asignación ya tenía ese estado."});
 }
 const statement=data.allow?
  env.DB.prepare([
   "INSERT INTO operator_case_assignments(account_id,request_id,assigned_by_account_id)",
   "VALUES (?,?,?) ON CONFLICT(account_id,request_id)",
   "DO UPDATE SET revoked_at=NULL,assigned_by_account_id=excluded.assigned_by_account_id,",
   "assigned_at=CURRENT_TIMESTAMP",
  ].join(" ")).bind(data.account_id,data.request_id,actor.account_id):
  env.DB.prepare([
   "UPDATE operator_case_assignments SET revoked_at=CURRENT_TIMESTAMP",
   "WHERE account_id=? AND request_id=? AND revoked_at IS NULL",
  ].join(" ")).bind(data.account_id,data.request_id);
 const changes=await env.DB.batch([
  statement,
  env.DB.prepare([
   "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation)",
   "VALUES (?,?,'operator_action',?)",
  ].join(" ")).bind(
   crypto.randomUUID(),actor.account_id,
   (data.allow?"CASE_GRANT ":"CASE_REVOKE ")+data.account_id+" "+data.request_id,
  ),
 ]);
 if(changes[0]?.meta?.changes!==1)return respond({success:false,message:"La asignación no pudo confirmarse."},409);
 return respond({success:true,allowed:data.allow,
  message:data.allow?"Expediente asignado al colaborador.":"Acceso a ese expediente revocado."});
}
