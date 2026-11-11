// DAUREL V2 — Bitácora de actuaciones de operador (SOLO staging).
// WhatsApp PERSONAL no está conectado: cada registro es una declaración manual
// del operador. Abrir WhatsApp o intentar un contacto NO certifica su recepción.
import {json} from "./demo-api.js";

const CHANNEL="daurel-v2-demo";
const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEM=/^[A-Za-z0-9._-]{8,100}$/;
const STATUS_SET=new Set(["new","contacted","in_attention","closed","cancelled"]);

// Campos: id, categoría, título, explicación, cambio automático sólo si el
// expediente está exactamente en el estado señalado.
const DEFINITIONS=Object.freeze([
 {id:"whatsapp_attempt",category:"Contacto",label:"Intenté contactar por WhatsApp",description:"Registré el intento. No significa que el cliente haya respondido."},
 {id:"call_attempt",category:"Contacto",label:"Intenté llamar",description:"La llamada pudo no haber sido atendida."},
 {id:"email_sent",category:"Contacto",label:"Envié un correo",description:"No implica lectura ni respuesta."},
 {id:"reply_received",category:"Contacto",label:"Cliente respondió",description:"Contacto confirmado por una respuesta del cliente.",auto_from:"new",auto_to:"contacted"},
 {id:"call_answered",category:"Contacto",label:"Llamada atendida",description:"La persona atendió y se concretó el contacto.",auto_from:"new",auto_to:"contacted"},
 {id:"appointment_scheduled",category:"Atención",label:"Cita programada",description:"Se acordó una fecha de atención. No implica que la cita ya ocurrió."},
 {id:"consultation_completed",category:"Atención",label:"Asesoría realizada",description:"Se llevó a cabo la asesoría.",auto_from:"contacted",auto_to:"in_attention"},
 {id:"documents_requested",category:"Documentos",label:"Documentos solicitados",description:"Se pidió información o documentos. No implica recepción."},
 {id:"documents_received",category:"Documentos",label:"Documentos recibidos",description:"Se recibieron los documentos; aún no significa que hayan sido revisados."},
 {id:"documents_reviewed",category:"Documentos",label:"Documentos revisados",description:"La revisión del asunto comenzó.",auto_from:"contacted",auto_to:"in_attention"},
 {id:"followup_done",category:"Seguimiento",label:"Seguimiento realizado",description:"Se registró un seguimiento manual del expediente."},
 {id:"case_referred",category:"Seguimiento",label:"Asunto canalizado",description:"Fue canalizado a una persona o institución; no supone resolución."},
 {id:"filing_completed",category:"Gestión",label:"Trámite presentado",description:"Se presentó una gestión o trámite.",auto_from:"contacted",auto_to:"in_attention"},
 {id:"response_received",category:"Gestión",label:"Respuesta institucional recibida",description:"Se recibió respuesta de la autoridad o institución."},
 {id:"client_updated",category:"Seguimiento",label:"Cliente informado del avance",description:"Se le comunicó un avance; sin certificar respuesta."},
 {id:"service_completed",category:"Cierre",label:"Servicio concluido y confirmado",description:"Solo registrar si la conclusión fue confirmada.",auto_from:"in_attention",auto_to:"closed",requires_confirmation:true},
]);
const MAP=new Map(DEFINITIONS.map(a=>[a.id,a]));

function respond(data,status=200){
 const r=json(data,status);
 r.headers.set("X-Robots-Tag","noindex,nofollow");
 return r;
}

export function operatorActionCatalog(){
 return respond({
  success:true,synthetic_only:true,
  actions:DEFINITIONS,
  notice:"WhatsApp personal no está conectado. Los intentos de contacto no cambian el estado automáticamente.",
 });
}

export async function operatorRecordAction(request,env){
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return respond({success:false,message:"Origen no permitido."},403);
 const type=(request.headers.get("Content-Type")||"").toLowerCase();
 if(!type.startsWith("application/json"))return respond({success:false,message:"Se requiere JSON."},415);
 const idem=request.headers.get("Idempotency-Key")||"";
 if(!IDEM.test(idem))return respond({success:false,message:"Falta clave de operación válida."},400);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>350)return respond({success:false,message:"Solicitud demasiado grande."},413);
 let input;
 try{input=JSON.parse(raw)}catch{return respond({success:false,message:"JSON inválido."},400)}
 if(!input||typeof input!=="object"||Array.isArray(input)||
   Object.keys(input).sort().join(",")!=="action,expected_status,request_id"||
   typeof input.action!=="string"||!MAP.has(input.action)||
   typeof input.request_id!=="string"||!REQUEST_ID.test(input.request_id)||
   typeof input.expected_status!=="string"||!STATUS_SET.has(input.expected_status)){
  return respond({success:false,message:"Actuación o expediente ficticio inválido."},400);
 }
 const {request_id:id,expected_status:expected,action:code}=input;
 const def=MAP.get(code);
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("daurel-v2-manual-action:"+id+":"+idem));
 const eventId="operator-action-"+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
 const eventType="operator_"+code;
 const proposed=def.auto_from===expected?def.auto_to:null;
 const summary="Actuación registrada: "+def.label+(proposed?" · Estado "+expected+" → "+proposed:"");
 // Un mismo Idempotency-Key debe representar una única actuación.
 const already=await env.DB.prepare([
  "SELECT e.event_type,e.summary,e.created_at",
  "FROM request_events e JOIN service_requests sr ON sr.request_id=e.request_id",
  "WHERE e.event_id=? AND e.request_id=? AND sr.intake_channel='staging_demo'",
 ].join(" ")).bind(eventId,id).first();
 if(already){
  if(already.event_type!==eventType||already.summary!==summary)
   return respond({success:false,message:"Esta clave ya se usó para otra actuación."},409);
  return respond({success:true,replayed:true,request_id:id,
   action:code,automatic_status_change:!!proposed,status:proposed||expected});
 }
 const current=await env.DB.prepare([
  "SELECT sr.status FROM service_requests sr",
  "JOIN external_identities ei ON ei.party_id=sr.requester_party_id",
  "WHERE sr.request_id=? AND sr.intake_channel='staging_demo'",
  "AND ei.channel_account_id=? LIMIT 1",
 ].join(" ")).bind(id,CHANNEL).first();
 if(!current)return respond({success:false,message:"El expediente ficticio no existe."},404);
 if(current.status!==expected)
  return respond({success:false,message:"El estado cambió. Actualiza la bandeja antes de registrar la actuación."},409);
 if(expected==="cancelled"||expected==="closed"&&code!=="followup_done"){
  return respond({success:false,message:"El asunto está cerrado o cancelado. Reábrelo desde Cambio de estado antes de continuar."},409);
 }

 if(proposed){
  const updates=await env.DB.batch([
   env.DB.prepare([
    "UPDATE service_requests SET status=?,updated_at=CURRENT_TIMESTAMP",
    "WHERE request_id=? AND status=? AND intake_channel='staging_demo'",
   ].join(" ")).bind(proposed,id,expected),
   env.DB.prepare([
    "INSERT OR IGNORE INTO request_events(event_id,request_id,event_type,summary)",
    "SELECT ?,sr.request_id,?,? FROM service_requests sr",
    "WHERE sr.request_id=? AND sr.intake_channel='staging_demo' AND sr.status=?",
    "AND changes()=1",
   ].join(" ")).bind(eventId,eventType,summary,id,proposed),
  ]);
  if(updates[0]?.meta?.changes!==1||updates[1]?.meta?.changes!==1)
   return respond({success:false,message:"La operación no se confirmó. Actualiza el panel."},409);
 }else{
  const result=await env.DB.prepare([
   "INSERT OR IGNORE INTO request_events(event_id,request_id,event_type,summary)",
   "SELECT ?,sr.request_id,?,? FROM service_requests sr",
   "WHERE sr.request_id=? AND sr.intake_channel='staging_demo' AND sr.status=?",
  ].join(" ")).bind(eventId,eventType,summary,id,expected).run();
  if(result.meta?.changes!==1)
   return respond({success:false,message:"No se confirmó la actuación. Actualiza el panel."},409);
 }
 return respond({
  success:true,replayed:false,request_id:id,
  action:code,automatic_status_change:!!proposed,
  status:proposed||expected,
  message:proposed?"Actuación registrada y estado actualizado automáticamente.":"Actuación registrada. El estado permanece sin cambios.",
 },201);
}
