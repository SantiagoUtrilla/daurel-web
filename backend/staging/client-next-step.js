// DAUREL V2 · Publicación explícita de "qué sigue" para cliente de ensayo.
// No envía mensajes; no muestra agenda interna ni permite texto libre.
// No genera fechas prometidas ni certifica que un profesional haya atendido.
// Owner-only (además de la autorización central del Worker).
import {json} from "./demo-api.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEM=/^[a-zA-Z0-9._-]{8,100}$/;
export const PUBLIC_NEXT_STEPS=Object.freeze({
 review_request:"DAUREL revisará la información de tu solicitud para determinar el siguiente paso.",
 prepare_guidance:"DAUREL preparará la orientación inicial de tu asunto.",
 coordinate_contact:"DAUREL buscará comunicarse contigo para acordar los próximos pasos.",
 await_documents:"DAUREL está a la espera de la documentación acordada contigo.",
 review_documents:"DAUREL revisará la documentación que hayas proporcionado.",
 coordinate_appointment:"DAUREL buscará coordinar una cita contigo. Aún no existe una fecha confirmada.",
 evaluate_referral:"DAUREL evaluará la canalización de tu asunto con un especialista.",
 verify_result:"DAUREL revisará el resultado de la gestión antes de comunicarlo.",
});
const EVENT_PUBLISHED="client_next_step_published";
const EVENT_CLEARED="client_next_step_cleared";
const KEY_PREFIX="client-step-v1:";
function reply(data,status=200){
 const r=json(data,status);r.headers.set("Cache-Control","no-store");
 r.headers.set("X-Robots-Tag","noindex,nofollow");return r;
}
function owner(env,actor){
 return env?.ENVIRONMENT==="staging" && actor?.role==="owner" && !!actor.account_id;
}
export async function currentClientNextStep(db,requestId){
 const row=await db.prepare([
  "SELECT event_type,summary,created_at FROM request_events",
  "WHERE request_id=? AND event_type IN (?,?) ORDER BY rowid DESC LIMIT 1",
 ].join(" ")).bind(requestId,EVENT_PUBLISHED,EVENT_CLEARED).first();
 if(!row||row.event_type===EVENT_CLEARED)return null;
 if(typeof row.summary!=="string"||!row.summary.startsWith(KEY_PREFIX))return null;
 const code=row.summary.slice(KEY_PREFIX.length);
 if(!Object.hasOwn(PUBLIC_NEXT_STEPS,code))return null;
 return {code,text:PUBLIC_NEXT_STEPS[code],published_at:row.created_at};
}
export async function ownerNextStepView(request,env,actor){
 if(!owner(env,actor))return reply({success:false,message:"Solo el propietario puede publicar el próximo paso."},403);
 const params=new URL(request.url).searchParams;
 if([...params.keys()].length!==1||!params.has("request_id"))
  return reply({success:false,message:"Identificador requerido."},400);
 const id=params.get("request_id");
 if(!UUID.test(id))return reply({success:false,message:"Identificador inválido."},400);
 const sr=await env.DB.prepare([
  "SELECT request_id,status FROM service_requests",
  "WHERE request_id=? AND intake_channel='staging_demo'",
 ].join(" ")).bind(id).first();
 if(!sr)return reply({success:false,message:"Expediente no encontrado."},404);
 return reply({success:true,synthetic_only:true,status:sr.status,
  templates:PUBLIC_NEXT_STEPS,
  current:await currentClientNextStep(env.DB,id),
  notice:"Publicar solo cambia lo que se ve en el portal del cliente. No envía mensajes ni crea tareas internas."});
}
async function hashId(id,key){
 const d=await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode("daurel-v2-next-step:"+id+":"+key));
 return "next-step-"+Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function ownerNextStepSave(request,env,actor){
 if(!owner(env,actor))return reply({success:false,message:"Solo el propietario puede publicar el próximo paso."},403);
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return reply({success:false,message:"Origen no permitido."},403);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return reply({success:false,message:"Se requiere JSON."},415);
 const idem=request.headers.get("Idempotency-Key")||"";
 if(!IDEM.test(idem))return reply({success:false,message:"Falta clave de operación válida."},400);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>420)
  return reply({success:false,message:"Solicitud demasiado grande."},413);
 let input;try{input=JSON.parse(raw)}catch{return reply({success:false,message:"JSON inválido."},400)}
 if(!input||Array.isArray(input)||typeof input!=="object"||
    Object.keys(input).sort().join(",")!=="action_code,expected_status,request_id"||
    typeof input.request_id!=="string"||!UUID.test(input.request_id)||
    typeof input.action_code!=="string"||
    !(Object.hasOwn(PUBLIC_NEXT_STEPS,input.action_code)||input.action_code==="clear")||
    typeof input.expected_status!=="string"||
    !["new","contacted","in_attention","closed","cancelled"].includes(input.expected_status))
  return reply({success:false,message:"Solo se permiten mensajes predefinidos de seguimiento."},400);
 const {request_id:id,action_code:code,expected_status:status}=input;
 const eventType=code==="clear"?EVENT_CLEARED:EVENT_PUBLISHED;
 const summary=KEY_PREFIX+code;
 const eventId=await hashId(id,idem);
 const existing=await env.DB.prepare([
  "SELECT event_type,summary FROM request_events WHERE event_id=?",
 ].join(" ")).bind(eventId).first();
 if(existing){
  if(existing.event_type!==eventType||existing.summary!==summary)
   return reply({success:false,message:"Esta clave ya se utilizó para otro paso."},409);
  return reply({success:true,replayed:true,code,
   message:"Esta publicación ya estaba registrada."});
 }
 const current=await env.DB.prepare([
  "SELECT status FROM service_requests WHERE request_id=? AND intake_channel='staging_demo'",
 ].join(" ")).bind(id).first();
 if(!current)return reply({success:false,message:"Expediente ficticio no encontrado."},404);
 if(current.status!==status)return reply({success:false,message:"El estado cambió. Actualiza la bandeja."},409);
 if(["closed","cancelled"].includes(status)&&code!=="clear")
  return reply({success:false,message:"No publiques nuevos pasos en expedientes concluidos o cancelados."},409);
 const published=await currentClientNextStep(env.DB,id);
 if(code==="clear"&&!published)return reply({success:true,replayed:true,code,message:"No había un próximo paso publicado."});
 if(published?.code===code)return reply({success:true,replayed:true,code,message:"Este próximo paso ya está publicado."});
 const result=await env.DB.prepare([
  "INSERT OR IGNORE INTO request_events(event_id,request_id,event_type,summary)",
  "SELECT ?,request_id,?,? FROM service_requests",
  "WHERE request_id=? AND intake_channel='staging_demo' AND status=?",
 ].join(" ")).bind(eventId,eventType,summary,id,status).run();
 if(result.meta?.changes!==1)
  return reply({success:false,message:"No se pudo confirmar la publicación. Actualiza el panel."},409);
 return reply({success:true,code,replayed:false,
  has_published_next_action:code!=="clear",
  message:code==="clear"
   ?"Próximo paso retirado del portal. No se envió mensaje."
   :"Próximo paso publicado en el portal del cliente. No se envió mensaje."},201);
}
