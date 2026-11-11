// DAUREL V2 · Lectura de bitácora administrativa en entorno de pruebas.
// Solo administradores "owner" autenticados. Sin token técnico ni sesión cliente.
// No registra el contenido de asuntos, OTP, cookies ni secretos.
import {json} from "./demo-api.js";

export async function operatorAuditLog(env,actor){
  if(env.ENVIRONMENT!=="staging"||!actor||actor.role!=="owner"){
    return json({success:false,message:"Solo la cuenta administradora puede consultar la bitácora."},403);
  }
  const results=await env.DB.prepare([
    "SELECT a.event_type,a.operation,a.created_at,",
    "COALESCE((",
      "SELECT e.email_normalized FROM account_emails e",
      "WHERE e.account_id=a.account_id AND e.verified_at IS NOT NULL",
      "ORDER BY e.verified_at ASC LIMIT 1",
    "),'(cuenta no identificada)') AS operator_email",
    "FROM operator_access_audit a",
    "ORDER BY a.created_at DESC,a.audit_id DESC LIMIT 50",
  ].join(" ")).all();
  const rows=(results.results||[]).map(row=>({
    event_type:row.event_type,
    operation:row.operation||null,
    date:row.created_at,
    operator_email:row.operator_email,
  }));
  const response=json({success:true,events:rows,limit:50,synthetic_only:true,
    notice:"Historial de accesos y acciones administrativas confirmadas. No incluye intentos fallidos."});
  response.headers.set("Cache-Control","no-store");
  response.headers.set("X-Robots-Tag","noindex,nofollow");
  return response;
}
