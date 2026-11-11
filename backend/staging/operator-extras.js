// Rutas propias del operador: no exponen la clave técnica ni el dossier por cliente.
import {createDemoRequest,json} from "./demo-api.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function operatorCreate(request,env){
 if(request.headers.get("Origin")!==new URL(request.url).origin)
  return json({success:false,message:"Origen no permitido."},403);
 return createDemoRequest(request,env);
}
export async function operatorHistory(env,requestId){
 if(!UUID.test(requestId))return json({success:false,message:"Asunto inválido."},400);
 const selected=await env.DB.prepare(
  "SELECT request_id,public_folio FROM service_requests WHERE request_id=? AND intake_channel='staging_demo'"
 ).bind(requestId).first();
 if(!selected)return json({success:false,message:"Expediente ficticio no encontrado."},404);
 const result=await env.DB.prepare([
  "SELECT event_type,summary,created_at FROM request_events",
  "WHERE request_id=? ORDER BY created_at DESC,event_id DESC LIMIT 100",
 ].join(" ")).bind(requestId).all();
 return json({success:true,public_folio:selected.public_folio,
  events:(result.results||[]).reverse(),synthetic_only:true});
}
