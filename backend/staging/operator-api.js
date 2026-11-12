// DAUREL V2 · Operador en STAGING, únicamente casos sintéticos.
// Toda ruta requiere STAGING_TEST_TOKEN verificado por worker.js.
// El inicio de sesión del cliente no concede permisos de operador.
import {json} from "./demo-api.js";
import {newSessionToken,tokenHash} from "./auth-core.js";
import {classifySyntheticRequest,countSyntheticAreas} from "./service-classification.js";

const CHANNEL="daurel-v2-demo";
const EMAIL="daurelcontact@gmail.com";
const STATUSES=Object.freeze({
 new:["contacted","cancelled"],
 contacted:["in_attention","closed","cancelled"],
 in_attention:["closed","cancelled"],
 closed:["in_attention"],
 cancelled:[],
});
const TYPE_LABELS=Object.freeze({
 "Solicitud ficticia: consulta laboral":"laboral",
 "Solicitud ficticia: asunto civil":"civil",
 "Solicitud ficticia: registro de marca":"marcas",
 "Solicitud ficticia: orientación general":"general",
});
const SEND_WINDOW_MS=30*1000;
const INVITE_TTL=24*60*60*1000;
const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEM=/^[A-Za-z0-9._-]{8,100}$/;
const INVITE_CONFIRM="autorizar-envio-de-prueba";

function reply(data,status=200){
 const r=json(data,status);r.headers.set("X-Robots-Tag","noindex, nofollow");return r;
}
function sameOrigin(request){
 return request.headers.get("Origin")===new URL(request.url).origin;
}
async function readJson(request,keys){
 if(!sameOrigin(request))return {error:"Origen no permitido.",status:403};
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")){
  return {error:"Se requiere JSON.",status:415};
 }
 const body=await request.text();
 if(new TextEncoder().encode(body).length>512){
  return {error:"Solicitud demasiado grande.",status:413};
 }
 let data;
 try{data=JSON.parse(body)}catch{return {error:"JSON inválido.",status:400}}
 if(!data||typeof data!=="object"||Array.isArray(data)||Object.keys(data).sort().join(",")!==keys.slice().sort().join(",")){
  return {error:"Parámetros no permitidos.",status:400};
 }
 return {data};
}
async function matter(db,requestId){
 if(!REQUEST_ID.test(requestId))return null;
 return db.prepare([
  "SELECT sr.request_id,sr.public_folio,sr.summary,sr.status,",
  "ei.provider_user_id AS client_key",
  "FROM service_requests sr",
  "JOIN external_identities ei ON ei.party_id=sr.requester_party_id",
  "AND ei.channel_account_id=?",
  "WHERE sr.request_id=? AND sr.intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(CHANNEL,requestId).first();
}
export async function operatorQueue(env,actor=null){
 const scoped=actor&&actor.role!=="owner";
 const access= scoped
  ?" AND EXISTS (SELECT 1 FROM operator_case_assignments oca WHERE oca.account_id=? AND oca.request_id=sr.request_id AND oca.revoked_at IS NULL)"
  :"";
 const statsStmt=env.DB.prepare([
  "SELECT COUNT(*) AS total,",
  "COUNT(DISTINCT requester_party_id) AS clients,",
  "SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) AS new_count,",
  "SUM(CASE WHEN status='contacted' THEN 1 ELSE 0 END) AS contacted_count,",
  "SUM(CASE WHEN status='in_attention' THEN 1 ELSE 0 END) AS attention_count,",
  "SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed_count",
  "FROM service_requests sr WHERE sr.intake_channel='staging_demo'"+access,
 ].join(" "));
 const stats=await (scoped?statsStmt.bind(actor.account_id):statsStmt).first();
 const stmt=env.DB.prepare([
  "SELECT sr.request_id,sr.public_folio,sr.summary,sr.status,sr.priority,",
  "sr.opened_at,sr.updated_at,ei.provider_user_id AS client_key,",
  "(SELECT COUNT(*) FROM account_request_access aa",
  "WHERE aa.request_id=sr.request_id AND aa.revoked_at IS NULL) AS granted_accounts",
  "FROM service_requests sr",
  "JOIN external_identities ei ON ei.party_id=sr.requester_party_id",
  "AND ei.channel_account_id=?",
  "WHERE sr.intake_channel='staging_demo'"+access,
  "ORDER BY sr.updated_at DESC,sr.opened_at DESC,sr.request_id DESC LIMIT 100",
 ].join(" "));
 const r=await (scoped?stmt.bind(CHANNEL,actor.account_id):stmt.bind(CHANNEL)).all();
 // Etiquetas derivadas exclusivamente del catálogo sintético; el SQL no asigna
 // colaboradores ni expone filas no autorizadas. Son totales de la página (100).
 const cases=(r.results||[]).map(c=>({...c,...classifySyntheticRequest(c.summary)}));
 return reply({
  success:true,environment:"staging",synthetic_only:true,
  statistics:{
   total:Number(stats?.total||0),clients:Number(stats?.clients||0),
   new:Number(stats?.new_count||0),contacted:Number(stats?.contacted_count||0),
   in_attention:Number(stats?.attention_count||0),closed:Number(stats?.closed_count||0),
  },
  area_page_counts:countSyntheticAreas(cases),
  area_counts_scope:"current_page_only",
  cases,limit:100,
 });
}

export async function operatorUpdateStatus(request,env){
 const parsed=await readJson(request,["request_id","expected_status","new_status"]);
 if(parsed.error)return reply({success:false,message:parsed.error},parsed.status);
 const {request_id:id,expected_status:expected,new_status:next}=parsed.data;
 const key=request.headers.get("Idempotency-Key")||"";
 if(!IDEM.test(key))return reply({success:false,message:"Falta una clave de operación válida."},400);
 if(!REQUEST_ID.test(id)||!Object.hasOwn(STATUSES,expected)||
   !Object.hasOwn(STATUSES,next)||!STATUSES[expected].includes(next)){
  return reply({success:false,message:"Transición de estado no permitida."},400);
 }
 const current=await matter(env.DB,id);
 if(!current)return reply({success:false,message:"Asunto ficticio inexistente."},404);

 // Cada comando conserva su propia identidad, incluso ante reintentos.
 const raw=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("daurel-v2-operator:"+id+":"+key));
 const eventId="operator-"+Array.from(new Uint8Array(raw),b=>b.toString(16).padStart(2,"0")).join("");
 const summary="Estado ficticio: "+expected+" → "+next;
 const oldEvent=await env.DB.prepare(
  "SELECT event_type,summary FROM request_events WHERE event_id=?"
 ).bind(eventId).first();
 if(oldEvent){
  if(oldEvent.event_type==="status_changed"&&oldEvent.summary===summary){
   return reply({success:true,replayed:true,request_id:id,status:next});
  }
  return reply({success:false,message:"Clave de operación usada con otro cambio."},409);
 }
 if(current.status!==expected){
  return reply({success:false,message:"El estado cambió. Actualiza el panel antes de volver a modificarlo."},409);
 }
 // No insertar historial si falla la transición. Batch confirma ambas escrituras juntas.
 const statements=[
  env.DB.prepare([
   "UPDATE service_requests SET status=?,updated_at=CURRENT_TIMESTAMP",
   "WHERE request_id=? AND intake_channel='staging_demo' AND status=?",
  ].join(" ")).bind(next,id,expected),
  env.DB.prepare([
   "INSERT OR IGNORE INTO request_events(event_id,request_id,event_type,summary)",
   "SELECT ?,sr.request_id,'status_changed',?",
   "FROM service_requests sr WHERE sr.request_id=?",
   "AND sr.intake_channel='staging_demo' AND sr.status=?",
   "AND changes()=1",
  ].join(" ")).bind(eventId,summary,id,next),
 ];
 const result=await env.DB.batch(statements);
 if(result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1){
  // Una carrera concurrente sin cambio de estado es inusual con el laboratorio;
  // devolver conflicto y nunca reportar un éxito no confirmado.
  return reply({success:false,message:"No se confirmó la transición. Actualiza el panel."},409);
 }
 return reply({success:true,replayed:false,request_id:id,status:next});
}

export async function operatorSendInvitation(request,env,transport=fetch,now=Date.now()){
 const parsed=await readJson(request,["request_id","confirm"]);
 if(parsed.error)return reply({success:false,message:parsed.error},parsed.status);
 const {request_id:id,confirm}=parsed.data;
 if(!REQUEST_ID.test(id)||confirm!==INVITE_CONFIRM){
  return reply({success:false,message:"Debes confirmar el expediente ficticio seleccionado."},400);
 }
 const selected=await matter(env.DB,id);
 if(!selected)return reply({success:false,message:"No existe el asunto de staging."},404);
 if(!Object.hasOwn(TYPE_LABELS,selected.summary)){
  return reply({success:false,message:"Ese asunto no corresponde a una prueba autorizada."},400);
 }
 if(env.AUTH_EMAIL_FROM!=="acceso@daurel.com.mx"||
   typeof env.RESEND_API_KEY!=="string"||env.RESEND_API_KEY.length<10){
  return reply({success:false,message:"Servicio de invitaciones no disponible en staging."},503);
 }
 const invitationId=crypto.randomUUID(),code=newSessionToken();
 const hash=await tokenHash(code);
 try{
  await env.DB.prepare([
   "INSERT INTO case_invitations(invitation_id,request_id,intended_email,code_sha256,issue_bucket,expires_at)",
   "VALUES(?,?,?,?,?,?)",
  ].join(" ")).bind(
   invitationId,id,EMAIL,hash,String(Math.floor(now/SEND_WINDOW_MS)),
   new Date(now+INVITE_TTL).toISOString(),
  ).run();
 }catch(error){
  if(/unique|constraint failed/i.test(String(error))){
   return reply({success:false,message:"Ya se envió una invitación para este expediente. Reintenta en unos segundos."},429);
  }
  throw error;
 }
 const link="https://daurel-backend-staging.lmsantiagoutrilla.workers.dev/v2/client#invite="+code;
 try{
  const delivery=await transport("https://api.resend.com/emails",{
   method:"POST",
   headers:{
    Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json",
    "Idempotency-Key":"daurel-v2-operator-invite/"+invitationId,
   },
   body:JSON.stringify({
    from:"DAUREL <"+env.AUTH_EMAIL_FROM+">",to:[EMAIL],
    subject:"DAUREL V2 — Acceso a tu expediente de prueba",
    text:[
     "Te invitamos a consultar tu expediente ficticio "+selected.public_folio+".",
     "Abre este enlace seguro (válido 24 horas, uso único):",
     link,
     "",
     "Si la sesión de DAUREL está cerrada, verificaremos tu correo en la misma página.",
     "No compartas este enlace. No da acceso a expedientes reales.",
    ].join("\n"),
   }),
  });
  if(!delivery.ok)throw Error("Proveedor rechazó envío");
 }catch{
  await env.DB.prepare(
   "UPDATE case_invitations SET revoked_at=CURRENT_TIMESTAMP WHERE invitation_id=?"
  ).bind(invitationId).run();
  return reply({success:false,message:"No se confirmó el envío. Inténtalo nuevamente más tarde."},502);
 }
 await env.DB.batch([
  env.DB.prepare(
   "UPDATE case_invitations SET sent_at=CURRENT_TIMESTAMP WHERE invitation_id=?"
  ).bind(invitationId),
  env.DB.prepare([
   "UPDATE case_invitations SET revoked_at=CURRENT_TIMESTAMP",
   "WHERE request_id=? AND intended_email=? AND invitation_id<>?",
   "AND redeemed_at IS NULL AND revoked_at IS NULL",
  ].join(" ")).bind(id,EMAIL,invitationId),
  env.DB.prepare([
   "INSERT INTO case_access_audit(audit_id,request_id,invitation_id,event_type)",
   "VALUES(?,?,?,'invitation_sent')",
  ].join(" ")).bind(crypto.randomUUID(),id,invitationId),
 ]);
 return reply({
  success:true,sent:true,public_folio:selected.public_folio,recipient:EMAIL,
  message:"Invitación de prueba enviada. La persona recibirá un enlace directo.",
  real_customer_access:false,
 },202);
}
