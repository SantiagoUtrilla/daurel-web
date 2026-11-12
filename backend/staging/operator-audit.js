// DAUREL V2 · Bitácora de administración: lista paginada o calendario compacto.
// Solo propietario autenticado en staging. No incluye OTP, cookies, secretos,
// expedientes ni conversaciones. Todas las fechas del historial usan UTC.
import {json} from "./demo-api.js";

const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const PAGE_SIZE=10;
function respond(data,status=200){
 const r=json(data,status);
 r.headers.set("Cache-Control","no-store");
 r.headers.set("X-Robots-Tag","noindex,nofollow");
 return r;
}
function validDate(value){
 if(!DATE.test(value))return false;
 const d=new Date(value+"T00:00:00.000Z");
 return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;
}
function nextDay(day){
 const d=new Date(day+"T00:00:00.000Z");
 d.setUTCDate(d.getUTCDate()+1);
 return d.toISOString().slice(0,10);
}
function nextMonth(month){
 const d=new Date(month+"-01T00:00:00.000Z");
 d.setUTCMonth(d.getUTCMonth()+1);
 return d.toISOString().slice(0,7);
}
export async function operatorAuditLog(env,actor,request=null){
 if(env.ENVIRONMENT!=="staging"||!actor||actor.role!=="owner"){
  return respond({success:false,message:"Solo la cuenta administradora puede consultar la bitácora."},403);
 }
 const url=new URL(request?.url||"https://staging.invalid/v2/operator/api/audit");
 const keys=Array.from(url.searchParams.keys());
 if(keys.some(k=>!["view","page","month","date"].includes(k))||new Set(keys).size!==keys.length)
  return respond({success:false,message:"Filtros de bitácora inválidos."},400);
 const view=url.searchParams.get("view")||"list";
 if(!["list","calendar"].includes(view))
  return respond({success:false,message:"Vista no permitida."},400);
 const month=url.searchParams.get("month");
 const day=url.searchParams.get("date");
 if(month!==null&&!MONTH.test(month))return respond({success:false,message:"Mes inválido."},400);
 if(day!==null&&!validDate(day))return respond({success:false,message:"Día inválido."},400);
 if(day&&month&&day.slice(0,7)!==month)
  return respond({success:false,message:"La fecha no corresponde al mes."},400);
 const pageText=url.searchParams.get("page")||"1";
 if(!/^[1-9]\d{0,3}$/.test(pageText)||Number(pageText)>1000)
  return respond({success:false,message:"Página inválida."},400);
 if(view==="calendar"&&(day!==null||url.searchParams.has("page")))
  return respond({success:false,message:"La vista calendario solo acepta el mes."},400);
 if(view==="calendar"){
  const selected=month||new Date().toISOString().slice(0,7);
  const start=selected+"-01";
  const end=nextMonth(selected)+"-01";
  const rows=await env.DB.prepare([
   "SELECT substr(created_at,1,10) AS date,COUNT(*) AS count",
   "FROM operator_access_audit WHERE created_at>=? AND created_at<?",
   "GROUP BY substr(created_at,1,10) ORDER BY date ASC",
  ].join(" ")).bind(start,end).all();
  const days=(rows.results||[]).map(r=>({date:r.date,count:Number(r.count)}));
  return respond({success:true,view:"calendar",month:selected,days,
   total:days.reduce((n,d)=>n+d.count,0),timezone:"UTC",synthetic_only:true});
 }
 const selectedMonth=month||null,selectedDate=day||null;
 const lower=selectedDate|| (selectedMonth?selectedMonth+"-01":null);
 const upper=selectedDate?nextDay(selectedDate):
  (selectedMonth?nextMonth(selectedMonth)+"-01":null);
 const where=lower?"WHERE a.created_at>=? AND a.created_at<?":"";
 const binds=lower?[lower,upper]:[];
 const countStmt=env.DB.prepare(
  "SELECT COUNT(*) AS total FROM operator_access_audit a "+where
 );
 const total=Number((await (lower?countStmt.bind(...binds):countStmt).first())?.total||0);
 const page=Number(pageText);
 const offset=(page-1)*PAGE_SIZE;
 const query=env.DB.prepare([
  "SELECT a.event_type,a.operation,a.created_at,",
  "COALESCE((",
   "SELECT e.email_normalized FROM account_emails e",
   "WHERE e.account_id=a.account_id AND e.verified_at IS NOT NULL",
   "ORDER BY e.verified_at ASC LIMIT 1",
  "),'(cuenta no identificada)') AS operator_email",
  "FROM operator_access_audit a",where,
  "ORDER BY a.created_at DESC,a.audit_id DESC LIMIT ? OFFSET ?",
 ].join(" "));
 const data=(await query.bind(...binds,PAGE_SIZE,offset).all()).results||[];
 return respond({success:true,view:"list",page,page_size:PAGE_SIZE,total,
  has_next:offset+data.length<total,has_previous:page>1,
  month:selectedMonth,date:selectedDate,timezone:"UTC",
  events:data.map(r=>({event_type:r.event_type,operation:r.operation||null,
   date:r.created_at,operator_email:r.operator_email})),
  synthetic_only:true,notice:"Solo accesos y operaciones administrativas confirmadas."});
}
