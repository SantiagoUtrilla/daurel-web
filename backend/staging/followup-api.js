// DAUREL V2 - agenda de pendientes por expediente, SOLO DATOS FICTICIOS.
// El semáforo se calcula al consultar, sin procesos de fondo ni pagos externos.
// Todas las rutas pasan antes por STAGING_TEST_TOKEN en worker.js.
import {json} from "./demo-api.js";

const REQUEST=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK=/^followup-[0-9a-f]{64}$/;
const KEY=/^[a-zA-Z0-9._-]{8,100}$/;
const CHANNEL="daurel-v2-demo";
const ACTIONS=Object.freeze({
 contact_again:"Volver a contactar al cliente",
 request_documents:"Solicitar documentos pendientes",
 review_documents:"Revisar documentación recibida",
 arrange_appointment:"Confirmar o programar cita",
 followup_authority:"Dar seguimiento ante autoridad",
 update_client:"Informar avance al cliente",
 review_response:"Revisar respuesta recibida",
 check_deadline:"Revisar plazo o vencimiento",
});
const CONTROL=Object.freeze({
 complete:{status:"completed",confirm:"confirmar-pendiente",event:"followup_completed",prefix:"Pendiente cumplido: "},
 cancel:{status:"cancelled",confirm:"cancelar-pendiente",event:"followup_cancelled",prefix:"Pendiente cancelado: "},
});
const ONE_DAY=86400000;
function response(data,status=200){
 const res=json(data,status);
 res.headers.set("X-Robots-Tag","noindex,nofollow");
 return res;
}
function todayInMexico(now=Date.now()){
 const d=new Date(now);
 const f=new Intl.DateTimeFormat("es-MX",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"});
 const p=f.formatToParts(d);
 const value=k=>p.find(x=>x.type===k)?.value;
 return [value("year"),value("month"),value("day")].join("-");
}
function dateIsValid(d){
 if(typeof d!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;
 const milliseconds=Date.parse(d+"T12:00:00.000Z");
 return Number.isFinite(milliseconds)&&new Date(milliseconds).toISOString().slice(0,10)===d;
}
function dayNumber(iso){return Date.parse(iso+"T12:00:00.000Z")/ONE_DAY;}
function traffic(due,today){
 const delta=dayNumber(due)-dayNumber(today);
 return delta<0?"red":delta<=2?"yellow":"green";
}
function checkOrigin(request){
 return request.headers.get("Origin")===new URL(request.url).origin;
}
async function readJson(request,fields){
 if(!checkOrigin(request))return {error:"Origen no permitido.",status:403};
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")){
  return {error:"Contenido JSON requerido.",status:415};
 }
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>320)return {error:"Contenido demasiado grande.",status:413};
 let data;
 try{data=JSON.parse(raw)}catch{return {error:"JSON inválido.",status:400}}
 if(!data||typeof data!=="object"||Array.isArray(data)||
   Object.keys(data).sort().join(",")!==fields.slice().sort().join(",")){
  return {error:"Campos no permitidos.",status:400};
 }
 return {data};
}
async function schemaReady(db){
 const row=await db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='followup_tasks' LIMIT 1"
 ).first();
 return !!row;
}
function schemaError(){
 return response({success:false,message:"Falta instalar 0004_followup_tasks.sql en la base de pruebas daurel-staging."},503);
}
async function hashedTaskId(requestId,key){
 const bytes=await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode("daurel-v2-followup:"+requestId+":"+key));
 return "followup-"+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}

export async function listFollowups(env,now=Date.now(),actor=null){
 if(!await schemaReady(env.DB))return schemaError();
 const today=todayInMexico(now);
 const scoped=actor&&actor.role!=="owner";
 const access=scoped
  ?" AND EXISTS(SELECT 1 FROM operator_case_assignments a WHERE a.request_id=f.request_id AND a.account_id=? AND a.revoked_at IS NULL)"
  :"";
 const stmt=env.DB.prepare([
  "SELECT f.task_id,f.request_id,f.action_code,f.due_date,f.status,",
  "f.created_at,f.completed_at,sr.public_folio,sr.summary,",
  "ei.provider_user_id AS client_key",
  "FROM followup_tasks f",
  "JOIN service_requests sr ON sr.request_id=f.request_id",
  "JOIN external_identities ei ON ei.party_id=sr.requester_party_id",
  "AND ei.channel_account_id=?",
  "WHERE sr.intake_channel='staging_demo'",
  "AND f.status='open'"+access,
  "ORDER BY f.due_date ASC,f.created_at ASC,f.task_id ASC LIMIT 150",
 ].join(" "));
 const r=await (scoped?stmt.bind(CHANNEL,actor.account_id):stmt.bind(CHANNEL)).all();
 const tasks=(r.results||[]).map(t=>({
  ...t,title:ACTIONS[t.action_code]||"Actuación pendiente",
  signal:traffic(t.due_date,today),
 }));
 return response({
  success:true,synthetic_only:true,timezone:"America/Mexico_City",today,
  count:tasks.length,
  summary:{
   overdue:tasks.filter(t=>t.signal==="red").length,
   soon:tasks.filter(t=>t.signal==="yellow").length,
   planned:tasks.filter(t=>t.signal==="green").length,
  },tasks,
  actions:Object.entries(ACTIONS).map(([code,title])=>({code,title})),
  has_background_reminders:false,
 });
}
export async function createFollowup(request,env,now=Date.now()){
 if(!await schemaReady(env.DB))return schemaError();
 const parsed=await readJson(request,["request_id","action_code","due_date"]);
 if(parsed.error)return response({success:false,message:parsed.error},parsed.status);
 const {request_id:id,action_code:action,due_date:date}=parsed.data;
 const key=request.headers.get("Idempotency-Key")||"";
 if(!REQUEST.test(id)||typeof action!=="string"||!Object.hasOwn(ACTIONS,action)||
   !dateIsValid(date)||!KEY.test(key)){
  return response({success:false,message:"Selecciona un asunto, pendiente y fecha válidos."},400);
 }
 const today=todayInMexico(now);
 const days=dayNumber(date)-dayNumber(today);
 if(days<0||days>365)return response({success:false,message:"La fecha debe ser de hoy a un máximo de un año."},400);
 const taskId=await hashedTaskId(id,key);
 const existing=await env.DB.prepare(
  "SELECT request_id,action_code,due_date,status FROM followup_tasks WHERE task_id=?"
 ).bind(taskId).first();
 if(existing){
  if(existing.request_id!==id||existing.action_code!==action||existing.due_date!==date)
   return response({success:false,message:"Esta clave ya se utilizó para otro pendiente."},409);
  return response({success:true,replayed:true,task_id:taskId,due_date:date,status:existing.status});
 }
 const matter=await env.DB.prepare([
  "SELECT sr.status",
  "FROM service_requests sr JOIN external_identities ei",
  "ON ei.party_id=sr.requester_party_id AND ei.channel_account_id=?",
  "WHERE sr.request_id=? AND sr.intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(CHANNEL,id).first();
 if(!matter)return response({success:false,message:"El expediente ficticio no existe."},404);
 if(["closed","cancelled"].includes(matter.status))
  return response({success:false,message:"Reabre el expediente antes de programar un pendiente."},409);
 try{
  const r=await env.DB.batch([
   env.DB.prepare([
    "INSERT INTO followup_tasks(task_id,request_id,action_code,due_date)",
    "SELECT ?,sr.request_id,?,? FROM service_requests sr",
    "WHERE sr.request_id=? AND sr.intake_channel='staging_demo'",
    "AND sr.status NOT IN ('closed','cancelled')",
   ].join(" ")).bind(taskId,action,date,id),
   env.DB.prepare([
    "INSERT OR IGNORE INTO request_events(event_id,request_id,event_type,summary)",
    "SELECT ?,f.request_id,'followup_scheduled',?",
    "FROM followup_tasks f WHERE f.task_id=? AND changes()=1",
   ].join(" ")).bind(
    "followup-created-"+taskId,
    "Pendiente programado: "+ACTIONS[action]+" · "+date,
    taskId,
   ),
  ]);
  if(r[0]?.meta?.changes!==1||r[1]?.meta?.changes!==1){
   return response({success:false,message:"No se confirmó el pendiente. Actualiza el panel."},409);
  }
 }catch(e){
  if(/unique|constraint failed/i.test(String(e))){
   return response({success:false,message:"Este expediente ya tiene ese pendiente en la misma fecha."},409);
  }
  throw e;
 }
 return response({success:true,replayed:false,task_id:taskId,due_date:date,
  signal:traffic(date,today),status:"open"},201);
}
export async function changeFollowup(request,env,kind){
 if(!await schemaReady(env.DB))return schemaError();
 const mode=CONTROL[kind];
 if(!mode)return response({success:false,message:"Operación no admitida."},400);
 const parsed=await readJson(request,["task_id","confirm"]);
 if(parsed.error)return response({success:false,message:parsed.error},parsed.status);
 const {task_id:id,confirm}=parsed.data;
 if(typeof id!=="string"||!TASK.test(id)||confirm!==mode.confirm){
  return response({success:false,message:"Confirma la operación del pendiente."},400);
 }
 const found=await env.DB.prepare([
  "SELECT f.task_id,f.request_id,f.status,f.action_code",
  "FROM followup_tasks f JOIN service_requests sr ON sr.request_id=f.request_id",
  "WHERE f.task_id=? AND sr.intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(id).first();
 if(!found)return response({success:false,message:"Pendiente ficticio no encontrado."},404);
 if(found.status===mode.status)
  return response({success:true,replayed:true,task_id:id,status:found.status});
 if(found.status!=="open")
  return response({success:false,message:"Este pendiente ya se cerró mediante otra operación."},409);
 const eventId="followup-"+kind+"-"+id;
 const result=await env.DB.batch([
  env.DB.prepare([
   "UPDATE followup_tasks SET status=?,",
   "completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP",
   "WHERE task_id=? AND status='open'",
   "AND EXISTS(SELECT 1 FROM service_requests sr",
   "WHERE sr.request_id=followup_tasks.request_id",
   "AND sr.intake_channel='staging_demo')",
  ].join(" ")).bind(mode.status,id),
  env.DB.prepare([
   "INSERT OR IGNORE INTO request_events(event_id,request_id,event_type,summary)",
   "SELECT ?,f.request_id,?,? FROM followup_tasks f",
   "WHERE f.task_id=? AND f.status=? AND changes()=1",
  ].join(" ")).bind(eventId,mode.event,mode.prefix+ACTIONS[found.action_code],id,mode.status),
 ]);
 if(result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1)
  return response({success:false,message:"La operación no se confirmó; actualiza la agenda."},409);
 return response({success:true,replayed:false,task_id:id,status:mode.status});
}
