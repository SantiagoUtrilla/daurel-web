// DAUREL V2 — Seguimiento del CLIENTE en staging: solo hitos aptos para consulta.
// No se entregan resúmenes internos, correos ajenos, notas, nombres de operadores,
// tareas de trabajo internas, enlaces privados ni documentos del expediente.
import {json} from "./demo-api.js";
import {sessionRecord} from "./auth-pilot-api.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS=Object.freeze({
 new:"Recibido",
 contacted:"Contacto confirmado",
 in_attention:"En atención",
 closed:"Concluido",
 cancelled:"Cancelado",
});
const WHAT_NEXT=Object.freeze({
 new:"DAUREL revisará la solicitud y buscará establecer contacto. Todavía no hay atención confirmada.",
 contacted:"El contacto quedó registrado. DAUREL revisará el siguiente paso para atender el asunto.",
 in_attention:"El asunto está en atención. Los avances se mostrarán cuando DAUREL los registre.",
 closed:"El asunto figura como concluido. Si necesitas una aclaración, comunícate con DAUREL.",
 cancelled:"El asunto figura como cancelado. Puedes comunicarte con DAUREL para solicitar orientación.",
});
// Solo acciones humanas explícitamente permitidas. Jamás devolver la columna summary.
const SAFE_ACTIONS=Object.freeze({
 operator_reply_received:"DAUREL registró una respuesta del cliente",
 operator_call_answered:"DAUREL registró una llamada atendida",
 operator_appointment_scheduled:"DAUREL registró una cita programada",
 operator_consultation_completed:"DAUREL registró una asesoría realizada",
 operator_documents_requested:"DAUREL registró una solicitud de documentos",
 operator_documents_received:"DAUREL registró documentos recibidos",
 operator_documents_reviewed:"DAUREL registró una revisión documental",
 operator_filing_completed:"DAUREL registró un trámite presentado",
 operator_response_received:"DAUREL registró una respuesta institucional",
 operator_client_updated:"DAUREL registró que informó un avance",
 operator_case_referred:"DAUREL registró la canalización del asunto",
 operator_service_completed:"DAUREL registró la conclusión del servicio",
});
function reply(body,status=200){
 const result=json(body,status);
 result.headers.set("Cache-Control","no-store");
 result.headers.set("X-Content-Type-Options","nosniff");
 result.headers.set("X-Robots-Tag","noindex,nofollow");
 return result;
}
function eventLabel(row){
 if(row.event_type==="request_created")return "Solicitud registrada";
 if(Object.hasOwn(SAFE_ACTIONS,row.event_type))return SAFE_ACTIONS[row.event_type];
 if(row.event_type==="status_changed"){
  // Un texto externo no puede inducir una etiqueta: formato exacto generado por el operador.
  const match=/^Estado ficticio: (new|contacted|in_attention|closed|cancelled) → (new|contacted|in_attention|closed|cancelled)$/.exec(row.summary||"");
  if(match)return "DAUREL actualizó el estado a: "+STATUS[match[2]];
 }
 return null;
}
export async function clientCaseProgress(request,env,now=Date.now()){
 if(env?.ENVIRONMENT!=="staging")
  return reply({success:false,message:"No disponible."},403);
 const session=await sessionRecord(request,env,now);
 if(!session)return reply({success:false,message:"Inicia sesión con tu correo verificado."},401);
 const params=new URL(request.url).searchParams;
 if([...params.keys()].length!==1||!params.has("request_id"))
  return reply({success:false,message:"Identificador del expediente requerido."},400);
 const id=params.get("request_id");
 if(!UUID.test(id))return reply({success:false,message:"Identificador inválido."},400);
 // Checar permiso directamente en D1, no confiar en folio, correo ni ID del cliente.
 const matter=await env.DB.prepare([
  "SELECT sr.request_id,sr.public_folio,sr.status,sr.opened_at,sr.updated_at",
  "FROM service_requests sr",
  "JOIN account_request_access ara ON ara.request_id=sr.request_id",
  "AND ara.account_id=? AND ara.revoked_at IS NULL",
  "JOIN accounts a ON a.account_id=ara.account_id AND a.status='active'",
  "WHERE sr.request_id=? AND sr.intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(session.account_id,id).first();
 if(!matter)return reply({success:false,message:"Expediente no disponible para esta cuenta."},404);
 // Un expediente con historia extensa no debe volver interminable el portal.
 // La consulta limita a los últimos 24 eventos, SIN mostrar sus contenidos privados.
 const query=await env.DB.prepare([
  "SELECT event_type,summary,created_at,event_id FROM request_events",
  "WHERE request_id=? AND (event_type='request_created'",
  "OR event_type='status_changed'",
  "OR event_type IN (",
  "'operator_reply_received','operator_call_answered',",
  "'operator_appointment_scheduled','operator_consultation_completed',",
  "'operator_documents_requested','operator_documents_received',",
  "'operator_documents_reviewed','operator_filing_completed',",
  "'operator_response_received','operator_client_updated',",
  "'operator_case_referred','operator_service_completed'))",
  "ORDER BY created_at DESC,event_id DESC LIMIT 24",
 ].join(" ")).bind(id).all();
 const events=(query.results||[]).map(row=>{
  const label=eventLabel(row);
  return label?{label,date:row.created_at}:null;
 }).filter(Boolean).reverse();
 // Hito de recepción siempre disponible, incluso para expedientes antiguos sin evento de alta.
 const timeline=[{label:"Solicitud recibida por DAUREL",date:matter.opened_at},
  ...events.filter(e=>e.label!=="Solicitud registrada")];
 return reply({
  success:true,synthetic_only:true,request_id:id,
  public_folio:matter.public_folio,status:matter.status,
  status_label:STATUS[matter.status]||"En revisión",
  next_step:WHAT_NEXT[matter.status]||"Comunícate con DAUREL para conocer el estado.",
  last_updated:matter.updated_at,
  milestones:timeline.slice(-25),
  has_published_next_action:false,
  notice:"Esta vista muestra únicamente hitos administrativos aptos para el cliente; no confirma comunicaciones externas ni establece una fecha de atención.",
 });
}
