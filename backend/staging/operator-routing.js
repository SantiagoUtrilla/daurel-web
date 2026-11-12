// DAUREL V2 · Bandeja de distribución por especialidad — solo STAGING.
// Analiza TODAS las solicitudes sintéticas abiertas con SQL agregado y
// devuelve páginas de hasta 20. NO asigna colaboradores ni altera permisos.
// Un lector asignado NO cuenta como responsable gestor.
import {json} from "./demo-api.js";

const AREAS=new Set(["all","juridica","contaduria","por_clasificar"]);
const SCOPES=new Set(["pending","all"]);
const PAGE_SIZE=20;
const areaCase=()=>{
 const legal=[
  "Solicitud ficticia: consulta laboral",
  "Solicitud ficticia: asunto civil",
  "Solicitud ficticia: registro de marca",
 ];
 const quoted=legal.map(s=>"'"+s.replaceAll("'","''")+"'").join(",");
 return "CASE WHEN sr.summary IN ("+quoted+") THEN 'juridica' "+
  "WHEN sr.summary='Solicitud ficticia: orientación contable' THEN 'contaduria' "+
  "ELSE 'por_clasificar' END";
};
const base=()=>[
 "WITH active_cases AS (SELECT sr.request_id,sr.public_folio,",
 "sr.summary,sr.status,sr.priority,sr.opened_at,",
 areaCase()+" AS area,",
 "EXISTS (",
  "SELECT 1 FROM operator_case_assignments ca",
  "JOIN operator_memberships m ON m.account_id=ca.account_id",
  "JOIN operator_approved_emails ap ON ap.account_id=ca.account_id",
  "JOIN account_emails ae ON ae.account_id=ca.account_id",
  "AND ae.email_normalized=ap.email_normalized",
  "WHERE ca.request_id=sr.request_id AND ca.revoked_at IS NULL",
  "AND m.status='active' AND m.revoked_at IS NULL",
  "AND m.role='manager' AND ae.verified_at IS NOT NULL",
 ") AS has_manager",
 "FROM service_requests sr",
 "WHERE sr.intake_channel='staging_demo'",
 "AND sr.status IN ('new','contacted','in_attention'))",
].join(" ");

function reply(data,status=200){
 const response=json(data,status);
 response.headers.set("Cache-Control","no-store");
 response.headers.set("X-Robots-Tag","noindex,nofollow");
 return response;
}
export async function operatorRoutingOverview(env,actor,request){
 if(env?.ENVIRONMENT!=="staging"||actor?.role!=="owner"||!actor?.account_id)
  return reply({success:false,message:"Solo el propietario puede consultar distribución."},403);
 const u=new URL(request.url),params=u.searchParams;
 const keys=Array.from(params.keys());
 if(keys.some(k=>!["area","scope","page"].includes(k))||
   new Set(keys).size!==keys.length)
  return reply({success:false,message:"Filtros no permitidos."},400);
 const area=params.get("area")||"all",scope=params.get("scope")||"pending";
 const pageString=params.get("page")||"1";
 if(!AREAS.has(area)||!SCOPES.has(scope)||!/^[1-9][0-9]{0,2}$/.test(pageString))
  return reply({success:false,message:"Selecciona área, vista y página válidas."},400);
 const page=Number(pageString);
 const required=await env.DB.prepare([
  "SELECT name FROM sqlite_master WHERE type='table'",
  "AND name IN ('operator_case_assignments','operator_memberships',",
  "'operator_approved_emails','account_emails')",
 ].join(" ")).all();
 if(new Set((required.results||[]).map(x=>x.name)).size!==4)
  return reply({success:false,message:"Falta la configuración del equipo de pruebas."},503);
 const summary=(await env.DB.prepare(base()+
  " SELECT area,COUNT(*) AS total,"+
  " SUM(CASE WHEN has_manager=0 THEN 1 ELSE 0 END) AS pending"+
  " FROM active_cases GROUP BY area").all()).results||[];
 const totals={juridica:{total:0,pending:0},contaduria:{total:0,pending:0},
  por_clasificar:{total:0,pending:0}};
 for(const row of summary){
  if(Object.hasOwn(totals,row.area)){
   totals[row.area]={total:Number(row.total)||0,pending:Number(row.pending)||0};
  }
 }
 const areas=area==="all"?Object.keys(totals):[area];
 const total=areas.reduce((n,k)=>n+(scope==="pending"?totals[k].pending:totals[k].total),0);
 const filters=["(?='all' OR area=?)","(?='all' OR has_manager=0)"];
 const sql=base()+
  " SELECT request_id,public_folio,summary,status,priority,opened_at,area,has_manager"+
  " FROM active_cases WHERE "+filters.join(" AND ")+
  " ORDER BY has_manager ASC,"+
  " CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,"+
  " opened_at ASC,request_id ASC LIMIT ? OFFSET ?";
 const result=await env.DB.prepare(sql)
  .bind(area,area,scope,PAGE_SIZE,(page-1)*PAGE_SIZE).all();
 const cases=(result.results||[]).map(row=>({
  request_id:row.request_id,public_folio:row.public_folio,
  summary:row.summary,area:row.area,status:row.status,
  priority:row.priority,opened_at:row.opened_at,
  has_verified_manager:Boolean(row.has_manager),
 }));
 return reply({success:true,synthetic_only:true,assignment_mode:"manual_only",
  count_scope:"all_open_staging_cases",scope,area,page,page_size:PAGE_SIZE,total,
  has_next:(page*PAGE_SIZE)<total,has_previous:page>1,
  areas:totals,cases,
  notice:"La clasificación agrupa asuntos. No verifica especialidades ni concede permisos."});
}
