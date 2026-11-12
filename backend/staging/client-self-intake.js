// DAUREL V2: recepción autónoma de expediente FICTICIO para un cliente
// YA autenticado con correo. Sin autorización manual del propietario.
// No es el formulario sin cuenta de producción. Únicamente staging.
import {json} from "./demo-api.js";
import {sessionRecord} from "./auth-pilot-api.js";

const CHANNEL="daurel-v2-demo";
const SOURCE="client-self-intake";
const LIMIT=3;
const TYPES=Object.freeze({
 general:"Solicitud ficticia: orientación general",
 laboral:"Solicitud ficticia: consulta laboral",
 civil:"Solicitud ficticia: asunto civil",
 contaduria:"Solicitud ficticia: orientación contable",
});
const KEY=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reply(data,status=200){const r=json(data,status);r.headers.set("X-Robots-Tag","noindex,nofollow");return r;}
function mexicoDay(now){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Mexico_City",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now));
 const p=k=>parts.find(x=>x.type===k)?.value;
 return p("year")+p("month")+p("day");
}
function randomFolio(day){
 const n=crypto.getRandomValues(new Uint32Array(1))[0]%10000;
 return "DAU-"+day+"-"+String(n).padStart(4,"0");
}
async function fingerprint(accountId,key){
 const buffer=await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode("daurel-client-intake|"+accountId+"|"+key));
 return Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,"0")).join("");
}
async function findPrior(env,idem,accountId){
 return env.DB.prepare([
  "SELECT sr.request_id,sr.public_folio,sr.summary,ara.revoked_at",
  "FROM integration_events ie JOIN service_requests sr ON sr.request_id=ie.request_id",
  "JOIN account_request_access ara ON ara.request_id=sr.request_id",
  "WHERE ie.provider='staging' AND ie.source_scope=? AND ie.external_event_id=?",
  "AND ara.account_id=? AND sr.intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(SOURCE,idem,accountId).first();
}
export async function createClientSelfRequest(request,env,now=Date.now()){
 if(env.ENVIRONMENT!=="staging")return reply({success:false,message:"Ruta no disponible."},403);
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return reply({success:false,message:"Origen no permitido."},403);
 const cookieSession=await sessionRecord(request,env,now);
 if(!cookieSession)return reply({success:false,message:"Verifica tu correo para iniciar este ensayo."},401);
 const idem=request.headers.get("Idempotency-Key")||"";
 if(!KEY.test(idem))return reply({success:false,message:"Falta identificador de envío válido."},400);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return reply({success:false,message:"Se requiere JSON."},415);
 const text=await request.text();
 if(new TextEncoder().encode(text).length>128)
  return reply({success:false,message:"Solicitud demasiado grande."},413);
 let payload;try{payload=JSON.parse(text)}catch{return reply({success:false,message:"Solicitud inválida."},400)}
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
    Object.keys(payload).join(",")!=="case_type"||
    typeof payload.case_type!=="string"||!Object.hasOwn(TYPES,payload.case_type))
  return reply({success:false,message:"Selecciona un servicio de prueba."},400);
 const summary=TYPES[payload.case_type];
 const digest=await fingerprint(cookieSession.account_id,idem);
 const prior=await findPrior(env,digest,cookieSession.account_id);
 if(prior){
  if(prior.summary!==summary)return reply({success:false,message:"Este envío ya se usó para otro servicio."},409);
  // Reintentar jamás restaura acceso previamente revocado.
  return reply({success:true,replayed:true,public_folio:prior.public_folio,
   access_active:prior.revoked_at===null,synthetic_only:true});
 }
 // Máximo tres solicitudes de ensayo por cuenta verificada al día.
 const limitKey="client-intake-"+cookieSession.account_id;
 const day=mexicoDay(now);
 const quota=await env.DB.prepare([
  "INSERT INTO auth_rate_limits(subject_hash,window_start,attempts) VALUES(?,?,1)",
  "ON CONFLICT(subject_hash,window_start) DO UPDATE SET attempts=attempts+1",
  "WHERE attempts<?",
 ].join(" ")).bind(limitKey,day,LIMIT).run();
 if(quota.meta?.changes!==1)
  return reply({success:false,message:"Límite de tres solicitudes ficticias por día alcanzado."},429);

 for(let n=0;n<8;n++){
  const id=crypto.randomUUID(),party=crypto.randomUUID();
  const folio=randomFolio(day);
  const clientKey="demo-self-"+crypto.randomUUID().replace(/-/g,"").slice(0,20);
  try{
   await env.DB.batch([
    env.DB.prepare([
     "INSERT OR IGNORE INTO channel_accounts",
     "(channel_account_id,provider,provider_account_id,label)",
     "VALUES (?,'staging','daurel-v2-demo','Pruebas DAUREL V2')",
    ].join(" ")).bind(CHANNEL),
    env.DB.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").bind(party),
    env.DB.prepare("INSERT INTO persons(party_id) VALUES (?)").bind(party),
    env.DB.prepare([
     "INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id)",
     "VALUES (?,?,?,?)",
    ].join(" ")).bind(crypto.randomUUID(),party,CHANNEL,clientKey),
    env.DB.prepare([
     "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
     "VALUES (?,?,?,?,'staging_demo')",
    ].join(" ")).bind(id,folio,party,summary),
    env.DB.prepare([
     "INSERT INTO request_participants(request_id,party_id,role)",
     "VALUES (?,?,'requester')",
    ].join(" ")).bind(id,party),
    env.DB.prepare([
     "INSERT INTO request_events(event_id,request_id,event_type,summary)",
     "VALUES (?,?,'request_created','Solicitud ficticia creada por cliente verificado')",
    ].join(" ")).bind(crypto.randomUUID(),id),
    env.DB.prepare([
     "INSERT INTO integration_events(integration_event_id,provider,source_scope,external_event_id,request_id,status,processed_at)",
     "VALUES (?,'staging',?,?,?,'completed',CURRENT_TIMESTAMP)",
    ].join(" ")).bind(crypto.randomUUID(),SOURCE,digest,id),
    env.DB.prepare([
     "INSERT INTO account_request_access(account_id,request_id,permission,grant_basis)",
     "VALUES (?,?,'view','verified_authorization')",
    ].join(" ")).bind(cookieSession.account_id,id),
    // Historial explícito: 0003 limita el catálogo de case_access_audit,
    // así que no atribuir una invitación inexistente al acceso automático.
    env.DB.prepare([
     "INSERT INTO request_events(event_id,request_id,event_type,summary)",
     "VALUES (?,?,'client_access_auto_granted','Acceso de cliente creado con su solicitud ficticia')",
    ].join(" ")).bind(crypto.randomUUID(),id),
   ]);
   return reply({success:true,public_folio:folio,access_active:true,synthetic_only:true,
    message:"Solicitud ficticia registrada y vinculada automáticamente a tu sesión."},201);
  }catch(e){
   if(!/unique|constraint failed/i.test(String(e)))throw e;
   const raced=await findPrior(env,digest,cookieSession.account_id);
   if(raced){
    if(raced.summary!==summary)return reply({success:false,message:"Envío duplicado con diferente servicio."},409);
    return reply({success:true,replayed:true,public_folio:raced.public_folio,
     access_active:raced.revoked_at===null,synthetic_only:true});
   }
  }
 }
 return reply({success:false,message:"No se pudo registrar el ensayo; conserva el mismo identificador de envío."},409);
}
