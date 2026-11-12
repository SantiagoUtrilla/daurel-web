// DAUREL V2 — Revocación de acceso de CLIENTES a expedientes ficticios.
// Solo propietario autenticado, staging, con auditoría y sin revocar sesiones
// de otros expedientes. No confundir con asignaciones de colaboradores.
import {json} from "./demo-api.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIRM="revocar-acceso-cliente-ficticio";
function reply(data,status=200){
 const result=json(data,status);
 result.headers.set("Cache-Control","no-store");
 result.headers.set("X-Robots-Tag","noindex,nofollow");
 return result;
}
export async function revokeClientAccess(request,env,actor){
 if(env.ENVIRONMENT!=="staging"||actor?.role!=="owner")
  return reply({success:false,message:"Solo el propietario puede retirar accesos de clientes."},403);
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return reply({success:false,message:"Origen no permitido."},403);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return reply({success:false,message:"Se requiere JSON."},415);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>256)
  return reply({success:false,message:"Solicitud demasiado grande."},413);
 let data;
 try{data=JSON.parse(raw)}catch{return reply({success:false,message:"Solicitud inválida."},400)}
 if(!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).sort().join(",")!=="confirm,request_id"||
    typeof data.request_id!=="string"||!UUID.test(data.request_id)||
    data.confirm!==CONFIRM)
  return reply({success:false,message:"Confirma el expediente ficticio exacto."},400);

 const tables=await env.DB.prepare([
  "SELECT name FROM sqlite_master WHERE type='table'",
  "AND name IN ('account_request_access','case_invitations','case_access_audit')",
 ].join(" ")).all();
 if(new Set((tables.results||[]).map(row=>row.name)).size!==3)
  return reply({success:false,message:"El esquema de invitaciones de staging no está instalado."},503);

 const id=data.request_id;
 const caseRow=await env.DB.prepare([
  "SELECT request_id,public_folio FROM service_requests",
  "WHERE request_id=? AND intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(id).first();
 if(!caseRow)return reply({success:false,message:"Expediente ficticio no encontrado."},404);

 // Una transacción revoca permisos vigentes e invitaciones no canjeadas.
 // El registro de auditoría solo se inserta si había algo que revocar.
 const results=await env.DB.batch([
  env.DB.prepare([
   "INSERT INTO case_access_audit(audit_id,request_id,event_type)",
   "SELECT ?,sr.request_id,'access_revoked' FROM service_requests sr",
   "WHERE sr.request_id=? AND sr.intake_channel='staging_demo'",
   "AND (EXISTS (SELECT 1 FROM account_request_access ara",
   "WHERE ara.request_id=sr.request_id AND ara.revoked_at IS NULL)",
   "OR EXISTS (SELECT 1 FROM case_invitations ci",
   "WHERE ci.request_id=sr.request_id AND ci.revoked_at IS NULL",
   "AND ci.redeemed_at IS NULL))",
  ].join(" ")).bind(crypto.randomUUID(),id),
  env.DB.prepare([
   "UPDATE account_request_access SET revoked_at=CURRENT_TIMESTAMP",
   "WHERE request_id=? AND revoked_at IS NULL",
  ].join(" ")).bind(id),
  env.DB.prepare([
   "UPDATE case_invitations SET revoked_at=CURRENT_TIMESTAMP",
   "WHERE request_id=? AND revoked_at IS NULL AND redeemed_at IS NULL",
  ].join(" ")).bind(id),
 ]);
 const revokedAccounts=Number(results[1]?.meta?.changes||0);
 const revokedInvites=Number(results[2]?.meta?.changes||0);
 return reply({
  success:true,public_folio:caseRow.public_folio,
  revoked_accounts:revokedAccounts,revoked_invitations:revokedInvites,
  replayed:revokedAccounts===0&&revokedInvites===0,
  synthetic_only:true,
  message:revokedAccounts||revokedInvites
   ?"Accesos e invitaciones pendientes retirados para este expediente ficticio."
   :"Este expediente ya no tenía accesos ni invitaciones pendientes.",
 });
}
