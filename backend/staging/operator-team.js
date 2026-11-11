// DAUREL V2 · Equipo del operador, staging únicamente.
// Autorización EXPLÍCITA del propietario, nunca por coincidencia de email.
// Reutiliza las tablas 0002 y 0006; no necesita migración adicional.
// La autorización NO envía correos automáticamente y no crea credenciales.
import {json} from "./demo-api.js";
import {normalizeEmail} from "./auth-core.js";

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES=new Set(["manager","reader"]);
const STATUSES=new Set(["active","disabled"]);
const MAX_COLLABORATORS=15;
export async function teamSchemaReady(env){
 const table=await env.DB.prepare(
  "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='operator_approved_emails'"
 ).first();
 return table?.ok===1;
}
function missingSchema(){
 return answer({success:false,message:"Antes de usar el equipo, instala 0007_operator_approvals.sql en daurel-staging."},503);
}
function answer(data,status=200){
 const response=json(data,status);
 response.headers.set("Cache-Control","no-store");
 response.headers.set("X-Robots-Tag","noindex,nofollow");
 return response;
}
function allowed(env,actor){
 return env.ENVIRONMENT==="staging"&&actor?.role==="owner"&&!!actor.account_id;
}
function originOK(req){return req.headers.get("Origin")===new URL(req.url).origin}
async function body(req,keys){
 if(!originOK(req))return {error:"Origen no permitido.",status:403};
 if(!(req.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return {error:"Se requiere JSON.",status:415};
 const raw=await req.text();
 if(raw.length>300)return {error:"Solicitud demasiado grande.",status:413};
 let payload;
 try{payload=JSON.parse(raw)}catch{return {error:"Datos inválidos.",status:400}}
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
    Object.keys(payload).sort().join(",")!==keys.slice().sort().join(",")){
  return {error:"Los campos de la solicitud no coinciden.",status:400};
 }
 return {payload};
}
export async function listOperatorTeam(env,actor){
 if(!allowed(env,actor))return answer({success:false,message:"Solo el propietario puede administrar colaboradores."},403);
 if(!await teamSchemaReady(env))return missingSchema();
 const results=await env.DB.prepare([
  "SELECT m.account_id,m.role,m.status,m.granted_at,m.revoked_at,",
  "a.email_normalized AS email,ae.verified_at",
  "FROM operator_approved_emails a",
  "JOIN operator_memberships m ON m.account_id=a.account_id",
  "LEFT JOIN account_emails ae ON ae.account_id=a.account_id",
  "AND ae.email_normalized=a.email_normalized",
  "WHERE m.role<>'owner'",
  "ORDER BY a.email_normalized ASC LIMIT 20",
 ].join(" ")).all();
 return answer({success:true,team:(results.results||[]).map(r=>({
  account_id:r.account_id,email:r.email,role:r.role,
  status:r.status,verified:r.verified_at!==null,
  authorized_at:r.granted_at,
 })),limit:MAX_COLLABORATORS,synthetic_only:true});
}
export async function addOperatorMember(req,env,actor){
 if(!allowed(env,actor))return answer({success:false,message:"Solo el propietario puede autorizar colaboradores."},403);
 if(!await teamSchemaReady(env))return missingSchema();
 const parsed=await body(req,["email","role"]);
 if(parsed.error)return answer({success:false,message:parsed.error},parsed.status);
 const email=normalizeEmail(parsed.payload.email),role=parsed.payload.role;
 if(!email||!ROLES.has(role)||email==="daurelcontact@gmail.com")
  return answer({success:false,message:"Utiliza otro correo válido y el rol gestor o lector."},400);
 const enrolled=await env.DB.prepare([
  "SELECT account_id FROM operator_approved_emails",
  "WHERE email_normalized=? LIMIT 1",
 ].join(" ")).bind(email).first();
 if(enrolled)return answer({success:false,message:"El correo ya está autorizado; usa Cambiar permisos."},409);
 const existing=await env.DB.prepare(
  "SELECT account_id FROM account_emails WHERE email_normalized=? LIMIT 1"
 ).bind(email).first();
 const count=await env.DB.prepare(
  "SELECT COUNT(*) AS n FROM operator_approved_emails"
 ).first();
 if(count.n>=MAX_COLLABORATORS)
  return answer({success:false,message:"El cupo del laboratorio está completo."},409);
 const id=existing?.account_id||crypto.randomUUID();
 try{
  const actions=[];
  if(!existing){
   actions.push(env.DB.prepare("INSERT INTO accounts(account_id) VALUES (?)").bind(id));
  }
  actions.push(env.DB.prepare([
   "INSERT INTO operator_memberships(account_id,role,status)",
   "VALUES (?,?,'active')",
  ].join(" ")).bind(id,role));
  // NO insertar en account_emails aún: verified_at NOT NULL.
  actions.push(env.DB.prepare([
   "INSERT INTO operator_approved_emails(email_normalized,account_id,approved_by_account_id)",
   "VALUES (?,?,?)",
  ].join(" ")).bind(email,id,actor.account_id));
  actions.push(env.DB.prepare([
   "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation)",
   "VALUES (?,?,'operator_action',?)",
  ].join(" ")).bind(crypto.randomUUID(),actor.account_id,"TEAM_AUTHORIZE "+role+" "+id));
  await env.DB.batch(actions);
 }catch(e){
  if(/unique|constraint failed|primary key/i.test(String(e)))
   return answer({success:false,message:"El colaborador ya tiene autorización o existe un conflicto de cuenta."},409);
  throw e;
 }
 return answer({success:true,account_id:id,role,status:"active",email,
  message:"Correo autorizado. Esa persona podrá solicitar su código de acceso. Aún no tiene sesión iniciada."},201);
}
export async function changeOperatorMember(req,env,actor){
 if(!allowed(env,actor))return answer({success:false,message:"Solo el propietario puede cambiar permisos."},403);
 if(!await teamSchemaReady(env))return missingSchema();
 const parsed=await body(req,["account_id","role","status"]);
 if(parsed.error)return answer({success:false,message:parsed.error},parsed.status);
 const {account_id:id,role,status}=parsed.payload;
 if(typeof id!=="string"||!ID.test(id)||!ROLES.has(role)||!STATUSES.has(status)||
    id===actor.account_id)
  return answer({success:false,message:"Colaborador o permisos no válidos."},400);
 const existing=await env.DB.prepare([
  "SELECT m.role,m.status FROM operator_memberships m",
  "JOIN operator_approved_emails a ON a.account_id=m.account_id",
  "WHERE m.account_id=? AND m.role<>'owner' LIMIT 1",
 ].join(" ")).bind(id).first();
 if(!existing)return answer({success:false,message:"Colaborador no encontrado."},404);
 if(existing.role===role&&existing.status===status)
  return answer({success:true,replayed:true,message:"Los permisos ya tenían esos valores."});
 const changed=await env.DB.batch([
  env.DB.prepare([
   "UPDATE operator_memberships SET role=?,status=?,",
   "revoked_at=CASE WHEN ?='disabled' THEN CURRENT_TIMESTAMP ELSE NULL END",
   "WHERE account_id=? AND role<>'owner'",
  ].join(" ")).bind(role,status,status,id),
  // Revocar sesiones existentes incluso ante cambio de rol para exigir nuevo OTP.
  env.DB.prepare([
   "UPDATE operator_sessions SET revoked_at=CURRENT_TIMESTAMP",
   "WHERE account_id=? AND revoked_at IS NULL",
  ].join(" ")).bind(id),
  env.DB.prepare([
   "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation)",
   "VALUES (?,?,'operator_action',?)",
  ].join(" ")).bind(crypto.randomUUID(),actor.account_id,"TEAM_CHANGE "+role+" "+status+" "+id),
 ]);
 if(changed[0]?.meta?.changes!==1)
  return answer({success:false,message:"La actualización no pudo confirmarse."},409);
 return answer({success:true,role,status,
  message:status==="disabled"?"Acceso desactivado; las sesiones quedaron revocadas.":
   "Permisos actualizados; debe iniciar sesión nuevamente."});
}
