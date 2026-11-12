// DAUREL V2 · Perfil profesional DECLARADO para equipo sintético (solo staging).
// No verifica cédulas, no decide competencias ni asigna expedientes.
// Propietario único modifica; los colaboradores nunca leen el directorio completo.
import {json} from "./demo-api.js";

export const SPECIALTIES=Object.freeze({
 juridica_laboral:{area:"juridica",label:"Derecho laboral"},
 juridica_civil:{area:"juridica",label:"Derecho civil"},
 juridica_marcas:{area:"juridica",label:"Marcas y propiedad intelectual"},
 contaduria:{area:"contaduria",label:"Contaduría"},
 arquitectura:{area:"arquitectura",label:"Arquitectura (futuro catálogo)"},
 ingenieria_civil:{area:"ingenieria",label:"Ingeniería civil (futuro catálogo)"},
});
const AVAILABILITY=new Set(["available","limited","unavailable"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function respond(obj,status=200){
 const r=json(obj,status);r.headers.set("Cache-Control","no-store");
 r.headers.set("X-Robots-Tag","noindex,nofollow");return r;
}
function authorized(env,actor){
 return env?.ENVIRONMENT==="staging"&&actor?.role==="owner"&&!!actor.account_id;
}
export async function professionalSchemaReady(env){
 const rows=await env.DB.prepare([
  "SELECT name FROM sqlite_master WHERE type='table' AND",
  "name IN ('operator_professional_profiles','operator_professional_capabilities')",
 ].join(" ")).all();
 return new Set((rows.results||[]).map(r=>r.name)).size===2;
}
export async function listProfessionalProfiles(env,actor){
 if(!authorized(env,actor))
  return respond({success:false,message:"Solo la cuenta propietaria puede consultar perfiles."},403);
 if(!await professionalSchemaReady(env))
  return respond({success:false,schema_ready:false,message:"Falta la migración 0008 en daurel-staging."},503);
 const rows=await env.DB.prepare([
  "SELECT e.account_id,e.email_normalized AS email,m.role,m.status,",
  "p.availability,p.capacity_limit,p.updated_at,",
  "a.verified_at AS email_verified,",
  "c.specialty_code,c.validation_status",
  "FROM operator_approved_emails e",
  "JOIN operator_memberships m ON m.account_id=e.account_id",
  "LEFT JOIN account_emails a ON a.account_id=e.account_id AND a.email_normalized=e.email_normalized",
  "LEFT JOIN operator_professional_profiles p ON p.account_id=e.account_id",
  "LEFT JOIN operator_professional_capabilities c ON c.account_id=e.account_id",
  "WHERE m.role IN ('reader','manager')",
  "ORDER BY e.email_normalized,c.specialty_code LIMIT 160",
 ].join(" ")).all();
 const map=new Map();
 for(const r of rows.results||[]){
  if(!map.has(r.account_id))map.set(r.account_id,{
   account_id:r.account_id,
   email:r.email,role:r.role,status:r.status,
   email_verified:r.email_verified!==null,
   configured:r.availability!==null,
   availability:r.availability||"unavailable",
   capacity_limit:r.capacity_limit===null?3:Number(r.capacity_limit),
   specialties:[],credential_verified:false,
   updated_at:r.updated_at||null,
  });
  if(r.specialty_code&&Object.hasOwn(SPECIALTIES,r.specialty_code)){
   map.get(r.account_id).specialties.push(r.specialty_code);
  }
 }
 return respond({success:true,synthetic_only:true,credentials_checked:false,
  automatic_assignment_enabled:false,
  allowed_specialties:SPECIALTIES,
  profiles:Array.from(map.values()),
  notice:"Especialidades declaradas: DAUREL todavía no valida credenciales profesionales."});
}
export async function saveProfessionalProfile(request,env,actor){
 if(!authorized(env,actor))
  return respond({success:false,message:"Solo la cuenta propietaria puede editar perfiles."},403);
 if(!await professionalSchemaReady(env))
  return respond({success:false,message:"Falta la migración 0008 en daurel-staging."},503);
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return respond({success:false,message:"Origen no permitido."},403);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))
  return respond({success:false,message:"Se requiere JSON."},415);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>700)
  return respond({success:false,message:"Perfil demasiado grande."},413);
 let v;try{v=JSON.parse(raw)}catch{return respond({success:false,message:"Perfil inválido."},400)}
 if(!v||typeof v!=="object"||Array.isArray(v)||
  Object.keys(v).sort().join(",")!=="account_id,availability,capacity_limit,specialties"||
  typeof v.account_id!=="string"||!UUID.test(v.account_id)||
  v.account_id===actor.account_id||
  !AVAILABILITY.has(v.availability)||
  !Number.isInteger(v.capacity_limit)||v.capacity_limit<1||v.capacity_limit>20||
  !Array.isArray(v.specialties)||v.specialties.length>6||
  v.specialties.some(s=>typeof s!=="string"||!Object.hasOwn(SPECIALTIES,s))||
  new Set(v.specialties).size!==v.specialties.length)
  return respond({success:false,message:"Perfil o especialidades no válidos."},400);
 const teammate=await env.DB.prepare([
  "SELECT m.account_id FROM operator_memberships m",
  "JOIN operator_approved_emails e ON e.account_id=m.account_id",
  "WHERE m.account_id=? AND m.role IN ('reader','manager') LIMIT 1",
 ].join(" ")).bind(v.account_id).first();
 if(!teammate)return respond({success:false,message:"Colaborador no autorizado."},404);
 // Perfiles sin especialidades son válidos: mantienen el registro, pero jamás
 // constituyen una candidatura para distribuir automáticamente.
 const existing=await env.DB.prepare([
  "SELECT availability,capacity_limit FROM operator_professional_profiles",
  "WHERE account_id=?",
 ].join(" ")).bind(v.account_id).first();
 const current=(await env.DB.prepare([
  "SELECT specialty_code FROM operator_professional_capabilities",
  "WHERE account_id=? ORDER BY specialty_code",
 ].join(" ")).bind(v.account_id).all()).results||[];
 const equal=existing&&existing.availability===v.availability&&
  Number(existing.capacity_limit)===v.capacity_limit&&
  JSON.stringify(current.map(c=>c.specialty_code).sort())===
  JSON.stringify([...v.specialties].sort());
 if(equal)return respond({success:true,replayed:true,message:"El perfil ya tenía esos datos."});
 const steps=[
  env.DB.prepare([
   "INSERT INTO operator_professional_profiles",
   "(account_id,availability,capacity_limit,updated_by_account_id) VALUES (?,?,?,?)",
   "ON CONFLICT(account_id) DO UPDATE SET",
   "availability=excluded.availability,capacity_limit=excluded.capacity_limit,",
   "updated_by_account_id=excluded.updated_by_account_id,updated_at=CURRENT_TIMESTAMP",
  ].join(" ")).bind(v.account_id,v.availability,v.capacity_limit,actor.account_id),
  env.DB.prepare("DELETE FROM operator_professional_capabilities WHERE account_id=?")
   .bind(v.account_id),
 ];
 for(const specialty of v.specialties){
  steps.push(env.DB.prepare([
   "INSERT INTO operator_professional_capabilities(account_id,specialty_code,validation_status)",
   "VALUES (?,?,'unverified')",
  ].join(" ")).bind(v.account_id,specialty));
 }
 steps.push(env.DB.prepare([
  "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation)",
  "VALUES (?,?,'operator_action',?)",
 ].join(" ")).bind(crypto.randomUUID(),actor.account_id,"PROFESSIONAL_PROFILE_UPDATED "+v.account_id));
 await env.DB.batch(steps);
 return respond({success:true,credential_verified:false,
  message:"Perfil de ensayo guardado. Especialidades sin validación de credenciales; sin asignaciones automáticas."});
}
