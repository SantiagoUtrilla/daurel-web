// DAUREL V2 · Captación SIN CUENTA y reclamación posterior por código (solo staging).
// DESACTIVADA por defecto. Requiere activación explícita y Turnstile verificado.
// Datos sintéticos. El acceso solo nace tras OTP al email fijo + código de un solo uso.
import {json} from "./demo-api.js";
import {newSessionToken,tokenHash} from "./auth-core.js";

const EMAIL="daurelcontact@gmail.com";
const SCOPE="guest-claim-staging";
const CHANNEL="daurel-v2-demo";
const CONFIRM_TTL=24*60*60*1000;
const DAY_LIMIT_PER_IP=3;
const DAY_LIMIT_TOTAL=30;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=Object.freeze({
 general:"Solicitud ficticia: orientación general",
 laboral:"Solicitud ficticia: consulta laboral",
 civil:"Solicitud ficticia: asunto civil",
 contaduria:"Solicitud ficticia: orientación contable",
});
const out=(data,status=200)=>{
 const r=json(data,status);
 r.headers.set("X-Robots-Tag","noindex,nofollow");
 r.headers.set("Referrer-Policy","no-referrer");
 return r;
};
export function guestEnabled(env){
 return env?.ENVIRONMENT==="staging"&&
  env?.STAGING_GUEST_INTAKE_ENABLED==="true"&&
  typeof env?.TURNSTILE_SECRET_KEY==="string"&&env.TURNSTILE_SECRET_KEY.length>=20&&
  typeof env?.TURNSTILE_SITE_KEY==="string"&&/^[A-Za-z0-9_-]{8,128}$/.test(env.TURNSTILE_SITE_KEY)&&
  typeof env?.AUTH_OTP_HMAC_SECRET==="string"&&env.AUTH_OTP_HMAC_SECRET.length>=32;
}
function dayCode(now){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now));
 const part=key=>parts.find(x=>x.type===key)?.value;
 return part("year")+part("month")+part("day");
}
async function sha(value){
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
 return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
async function priorRecord(db,token){
 return db.prepare([
  "SELECT sr.request_id,sr.public_folio,sr.summary",
  "FROM integration_events ie JOIN service_requests sr ON sr.request_id=ie.request_id",
  "WHERE ie.provider='staging' AND ie.source_scope=?",
  "AND ie.external_event_id=? AND sr.intake_channel='staging_demo' LIMIT 1",
 ].join(" ")).bind(SCOPE,token).first();
}
async function verifyTurnstile(request,env,token,transport){
 const body=new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token});
 const ip=request.headers.get("CF-Connecting-IP");
 if(ip)body.set("remoteip",ip);
 const res=await transport("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:body.toString(),
 });
 if(!res.ok)return false;
 const reply=await res.json();
 return reply?.success===true&&
  reply.hostname===new URL(request.url).hostname&&
  reply.action==="guest_staging";
}
export async function submitGuestRequest(request,env,transport=fetch,now=Date.now()){
 if(!guestEnabled(env))return out({success:false,message:"Este ensayo sin cuenta todavía no está habilitado."},503);
 if(request.headers.get("Origin")!==new URL(request.url).origin)return out({success:false,message:"Origen no autorizado."},403);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return out({success:false,message:"Se requiere JSON."},415);
 const idem=request.headers.get("Idempotency-Key")||"";
 if(!ID.test(idem))return out({success:false,message:"Identificador de envío inválido."},400);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>4096)return out({success:false,message:"Solicitud demasiado grande."},413);
 let payload;try{payload=JSON.parse(raw)}catch{return out({success:false,message:"Solicitud inválida."},400)}
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
  Object.keys(payload).sort().join(",")!=="case_type,turnstile_token"||
  typeof payload.case_type!=="string"||!Object.hasOwn(TYPES,payload.case_type)||
  typeof payload.turnstile_token!=="string"||payload.turnstile_token.length<5||
  payload.turnstile_token.length>2048)
  return out({success:false,message:"Completa el servicio y la verificación de seguridad."},400);
 const ip=request.headers.get("CF-Connecting-IP");
 // El Worker público de Cloudflare normalmente incluye este encabezado,
 // exigimos su presencia para no crear una cuota compartida entre usuarios.
 if(!ip||ip.length>64)return out({success:false,message:"No fue posible comprobar el origen de esta prueba."},403);
 const digest=await sha(env.AUTH_OTP_HMAC_SECRET+"|"+ip+"|"+idem);
 const previous=await priorRecord(env.DB,digest);
 if(previous){
  if(previous.summary!==TYPES[payload.case_type])
   return out({success:false,message:"Este envío corresponde a otro servicio."},409);
  return out({success:true,replayed:true,public_folio:previous.public_folio,
   claim_code_available:false,message:"Esta solicitud ya se registró. Por seguridad no se muestra de nuevo el código de recuperación."});
 }
 let passed=false;
 try{passed=await verifyTurnstile(request,env,payload.turnstile_token,transport)}catch{}
 if(!passed)return out({success:false,message:"Verificación de seguridad no válida o vencida."},403);
 const day=dayCode(now);
 const ipHash=await sha(env.AUTH_OTP_HMAC_SECRET+"|guest-intake|"+ip);
 const quota=await env.DB.prepare([
  "INSERT INTO auth_rate_limits(subject_hash,window_start,attempts)",
  "VALUES(?,?,1) ON CONFLICT(subject_hash,window_start)",
  "DO UPDATE SET attempts=attempts+1 WHERE attempts<?",
 ].join(" ")).bind("guest-ip-"+ipHash,day,DAY_LIMIT_PER_IP).run();
 if(quota.meta?.changes!==1)return out({success:false,message:"Máximo tres solicitudes ficticias al día por conexión."},429);
 const total=await env.DB.prepare([
  "INSERT INTO auth_rate_limits(subject_hash,window_start,attempts)",
  "VALUES('guest-global-staging',?,1) ON CONFLICT(subject_hash,window_start)",
  "DO UPDATE SET attempts=attempts+1 WHERE attempts<?",
 ].join(" ")).bind(day,DAY_LIMIT_TOTAL).run();
 if(total.meta?.changes!==1)return out({success:false,message:"Cupo diario de laboratorio alcanzado."},429);
 const code=newSessionToken();
 const codeHash=await tokenHash(code);
 const expires=new Date(now+CONFIRM_TTL).toISOString();
 for(let tries=0;tries<8;tries++){
  const requestId=crypto.randomUUID(),partyId=crypto.randomUUID();
  const clientKey="demo-guest-"+crypto.randomUUID().replace(/-/g,"").slice(0,18);
  const random=crypto.getRandomValues(new Uint32Array(1))[0]%10000;
  const folio="DAU-"+day+"-"+String(random).padStart(4,"0");
  const invitationId=crypto.randomUUID();
  try{
   await env.DB.batch([
    env.DB.prepare([
     "INSERT OR IGNORE INTO channel_accounts",
     "(channel_account_id,provider,provider_account_id,label)",
     "VALUES (?,'staging','daurel-v2-demo','Laboratorio ficticio DAUREL')",
    ].join(" ")).bind(CHANNEL),
    env.DB.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").bind(partyId),
    env.DB.prepare("INSERT INTO persons(party_id) VALUES (?)").bind(partyId),
    env.DB.prepare([
     "INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id)",
     "VALUES (?,?,?,?)",
    ].join(" ")).bind(crypto.randomUUID(),partyId,CHANNEL,clientKey),
    env.DB.prepare([
     "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
     "VALUES (?,?,?,?,'staging_demo')",
    ].join(" ")).bind(requestId,folio,partyId,TYPES[payload.case_type]),
    env.DB.prepare([
     "INSERT INTO request_participants(request_id,party_id,role)",
     "VALUES (?,?,'requester')",
    ].join(" ")).bind(requestId,partyId),
    env.DB.prepare([
     "INSERT INTO request_events(event_id,request_id,event_type,summary)",
     "VALUES (?,?,'request_created','Solicitud de prueba sin cuenta registrada')",
    ].join(" ")).bind(crypto.randomUUID(),requestId),
    env.DB.prepare([
     "INSERT INTO integration_events(integration_event_id,provider,source_scope,external_event_id,request_id,status,processed_at)",
     "VALUES (?,'staging',?,?,?,'completed',CURRENT_TIMESTAMP)",
    ].join(" ")).bind(crypto.randomUUID(),SCOPE,digest,requestId),
    // Token entregado exclusivamente al navegador solicitante como código de recuperación;
    // no se envía a ningún correo. El canje requiere OTP posterior del correo FIJO del laboratorio.
    env.DB.prepare([
     "INSERT INTO case_invitations",
     "(invitation_id,request_id,intended_email,code_sha256,issue_bucket,expires_at,sent_at)",
     "VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)",
    ].join(" ")).bind(invitationId,requestId,EMAIL,codeHash,"guest-"+invitationId,expires),
    env.DB.prepare([
     "INSERT INTO request_events(event_id,request_id,event_type,summary)",
     "VALUES (?,?,'guest_claim_issued','Código privado de reclamación generado para pruebas')",
    ].join(" ")).bind(crypto.randomUUID(),requestId),
   ]);
   return out({success:true,created:true,public_folio:folio,
    claim_code:code,expires_in_seconds:86400,synthetic_only:true,
    message:"Guarda este código privado: sirve para vincular el expediente tras verificar el correo de pruebas."},201);
  }catch(e){
   if(!/unique|constraint failed/i.test(String(e)))throw e;
   const raced=await priorRecord(env.DB,digest);
   if(raced)return out({success:true,replayed:true,public_folio:raced.public_folio,
    claim_code_available:false,message:"Solicitud ya registrada. El código privado solo se muestra una vez."});
  }
 }
 return out({success:false,message:"No se pudo registrar la prueba."},409);
}
