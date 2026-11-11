// DAUREL V2 - recordatorios privados vía Telegram. SOLO staging, datos ficticios.
// Modo envío DESACTIVADO por defecto. Requiere 3 secretos independientes:
// DAUREL_V2_ALERTS_ENABLED=true, DAUREL_V2_TELEGRAM_BOT_TOKEN, DAUREL_V2_TELEGRAM_CHAT_ID.
// El Worker no envía SMS/WhatsApp ni instala software en el teléfono.
// La notificación evita nombres, contactos, descripciones y datos de expedientes reales.
import {json} from "./demo-api.js";

const CHANNEL="daurel-v2-demo";
const UTC_DAY=86400000;
const ACTIONS=Object.freeze({
 contact_again:"Volver a contactar",
 request_documents:"Solicitar documentos",
 review_documents:"Revisar documentación",
 arrange_appointment:"Confirmar cita",
 followup_authority:"Seguimiento ante autoridad",
 update_client:"Informar avance",
 review_response:"Revisar respuesta",
 check_deadline:"Revisar vencimiento",
});
const SOURCE="staging-followup-daily";
const PROVIDER="telegram-staging";
const CRON="0 15 * * *";

function localToday(now){
 const parts=new Intl.DateTimeFormat("en-US",{
  timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
 }).formatToParts(new Date(now));
 const read=k=>parts.find(p=>p.type===k)?.value;
 return read("year")+"-"+read("month")+"-"+read("day");
}
function tomorrow(iso){
 return new Date(Date.parse(iso+"T12:00:00.000Z")+UTC_DAY).toISOString().slice(0,10);
}
function configuration(env){
 return {
  enabled:env.DAUREL_V2_ALERTS_ENABLED==="true",
  configured:typeof env.DAUREL_V2_TELEGRAM_BOT_TOKEN==="string" &&
   /^[0-9]{6,15}:[A-Za-z0-9_-]{25,}$/.test(env.DAUREL_V2_TELEGRAM_BOT_TOKEN) &&
   typeof env.DAUREL_V2_TELEGRAM_CHAT_ID==="string" &&
   /^-?[0-9]{5,20}$/.test(env.DAUREL_V2_TELEGRAM_CHAT_ID),
 };
}
async function schemaReady(env){
 const found=await env.DB.prepare(
  "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='followup_tasks' LIMIT 1"
 ).first();
 return found?.ok===1;
}
function response(value,status=200){
 const r=json(value,status);r.headers.set("X-Robots-Tag","noindex,nofollow");return r;
}

export async function reminderDigest(env,now=Date.now()){
 if(env.ENVIRONMENT!=="staging")throw Error("Recordatorios solo en staging");
 if(!await schemaReady(env))throw Error("La agenda 0004 no está instalada.");
 const today=localToday(now),next=tomorrow(today);
 // Nada de números telefónicos ni nombres. Solo folios ficticios y códigos de tareas.
 // La consulta excluye solicitudes cerradas o canceladas.
 const result=await env.DB.prepare([
  "SELECT f.task_id,f.due_date,f.action_code,sr.public_folio",
  "FROM followup_tasks f",
  "JOIN service_requests sr ON sr.request_id=f.request_id",
  "JOIN external_identities ei ON ei.party_id=sr.requester_party_id",
  "AND ei.channel_account_id=?",
  "WHERE sr.intake_channel='staging_demo'",
  "AND sr.status NOT IN ('closed','cancelled')",
  "AND f.status='open' AND f.due_date<=?",
  "ORDER BY f.due_date ASC,f.created_at ASC,f.task_id ASC",
  "LIMIT 25",
 ].join(" ")).bind(CHANNEL,next).all();
 const tasks=(result.results||[]).map(r=>({
  public_folio:r.public_folio,
  due_date:r.due_date,
  action:ACTIONS[r.action_code]||"Pendiente",
  timing:r.due_date<today?"overdue":r.due_date===today?"today":"tomorrow",
 }));
 const counts={
  overdue:tasks.filter(x=>x.timing==="overdue").length,
  today:tasks.filter(x=>x.timing==="today").length,
  tomorrow:tasks.filter(x=>x.timing==="tomorrow").length,
 };
 const lines=[
  "DAUREL V2 · Agenda de PRUEBAS",
  "Fecha de México: "+today,
  "Vencidos: "+counts.overdue+" | Hoy: "+counts.today+" | Mañana: "+counts.tomorrow,
 ];
 for(const item of tasks){
  const when=item.timing==="overdue"?"VENCIDO":item.timing==="today"?"HOY":"MAÑANA";
  lines.push(when+" · "+item.public_folio+" · "+item.action+" · "+item.due_date);
 }
 if(!tasks.length)lines.push("Sin pendientes inmediatos.");
 lines.push("Abre el Centro de operaciones DAUREL V2 para revisar los detalles.");
 return {today,counts,count:tasks.length,items:tasks,text:lines.join("\n"),truncated:tasks.length===25};
}

export async function previewDailyAlerts(env,now=Date.now()){
 if(env.ENVIRONMENT!=="staging")return response({success:false,message:"Solo staging."},403);
 let digest;
 try{digest=await reminderDigest(env,now)}
 catch{return response({success:false,message:"Primero activa la agenda de seguimiento en daurel-staging."},503)}
 const config=configuration(env);
 return response({
  success:true,synthetic_only:true,
  telegram_configured:config.configured,
  delivery_enabled:config.enabled,
  sending_active:config.enabled&&config.configured,
  cron_utc:CRON,
  local_delivery_time:"09:00 America/Mexico_City",
  preview:digest,
  message:"Esta vista no envía ningún mensaje. Telegram no está conectado hasta configurar y habilitar sus secretos.",
 });
}

// Sólo puede llamarse desde el handler scheduled() — nunca desde una ruta pública.
// La reserva en integration_events evita envíos duplicados comunes en reintentos.
// Telegram no permite idempotencia transaccional: un fallo después de la entrega
// y antes del acuse puede producir un reenvío; no afirmar exactamente-una-vez.
export async function sendDailyAlerts(env,now=Date.now(),transport=fetch){
 if(env.ENVIRONMENT!=="staging")return {sent:false,reason:"not_staging"};
 const c=configuration(env);
 if(!c.enabled||!c.configured)return {sent:false,reason:"not_enabled"};
 const digest=await reminderDigest(env,now);
 if(!digest.count)return {sent:false,reason:"no_due_tasks"};
 const eventKey=digest.today;
 const eventId=crypto.randomUUID();
 const inserted=await env.DB.prepare([
  "INSERT OR IGNORE INTO integration_events",
  "(integration_event_id,provider,source_scope,external_event_id,status)",
  "VALUES (?, ?, ?, ?, 'processing')",
 ].join(" ")).bind(eventId,PROVIDER,SOURCE,eventKey).run();

 if(inserted.meta?.changes!==1){
  const existing=await env.DB.prepare([
   "SELECT status FROM integration_events",
   "WHERE provider=? AND source_scope=? AND external_event_id=?",
 ].join(" ")).bind(PROVIDER,SOURCE,eventKey).first();
  if(existing?.status==="completed")return {sent:false,reason:"already_sent"};
  if(existing?.status!=="failed")return {sent:false,reason:"already_processing"};
  const claimed=await env.DB.prepare([
   "UPDATE integration_events SET status='processing'",
   "WHERE provider=? AND source_scope=? AND external_event_id=? AND status='failed'",
  ].join(" ")).bind(PROVIDER,SOURCE,eventKey).run();
  if(claimed.meta?.changes!==1)return {sent:false,reason:"already_processing"};
 }
 try{
  // Los secretos viajan únicamente en la solicitud de servidor a Telegram.
  // No registrar la URL ni el payload en console.log.
  const res=await transport(
   "https://api.telegram.org/bot"+env.DAUREL_V2_TELEGRAM_BOT_TOKEN+"/sendMessage",
   {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
     chat_id:env.DAUREL_V2_TELEGRAM_CHAT_ID,
     text:digest.text,
     disable_web_page_preview:true,
    }),
   },
  );
  if(!res.ok)throw Error("Telegram no aceptó el mensaje");
  const body=await res.json();
  if(body.ok!==true)throw Error("Telegram no confirmó el envío");
  await env.DB.prepare([
   "UPDATE integration_events SET status='completed',processed_at=CURRENT_TIMESTAMP",
   "WHERE provider=? AND source_scope=? AND external_event_id=?",
   "AND status='processing'",
  ].join(" ")).bind(PROVIDER,SOURCE,eventKey).run();
  return {sent:true,count:digest.count,day:eventKey};
 }catch{
  await env.DB.prepare([
   "UPDATE integration_events SET status='failed',processed_at=CURRENT_TIMESTAMP",
   "WHERE provider=? AND source_scope=? AND external_event_id=?",
   "AND status='processing'",
  ].join(" ")).bind(PROVIDER,SOURCE,eventKey).run();
  return {sent:false,reason:"delivery_failed"};
 }
}
