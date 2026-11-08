// Sondeo restringido de envío de correo Resend (no login).
// Verificar STAGING_TEST_TOKEN en worker.js ANTES de llamar esta función.
import {json} from "./demo-api.js";
import {sendStagingTestEmail} from "./email-provider.js";

const PROVIDER="resend_staging_test";
const SCOPE="delivery_probe_v1";

export async function sendStagingDeliveryProbe(request, env, transport=fetch, now=Date.now()) {
  // La interfaz no permite destinatarios, remitentes ni mensajes personalizados.
  const payload=await request.text();
  if(payload.length!==0){
    return json({success:false,message:"Esta prueba no admite datos ni destinatarios."},400);
  }
  if(typeof env.RESEND_API_KEY!=="string" || env.RESEND_API_KEY.length<10 ||
     env.AUTH_EMAIL_FROM!=="acceso@daurel.com.mx"){
    return json({
      success:false,
      message:"Falta RESEND_API_KEY o AUTH_EMAIL_FROM=acceso@daurel.com.mx en staging.",
    },503);
  }
  const minuteBucket=Math.floor(now/60000);
  const bucket=String(minuteBucket);
  const reserved=await env.DB.prepare([
    "INSERT OR IGNORE INTO integration_events(",
    "integration_event_id,provider,source_scope,external_event_id,status)",
    "VALUES (?, ?, ?, ?, 'received')",
  ].join(" ")).bind(crypto.randomUUID(),PROVIDER,SCOPE,bucket).run();
  if(reserved?.meta?.changes!==1){
    return json({success:false,message:"Ya se intentó un envío en este minuto. Reintenta después."},429);
  }

  async function release(){
    await env.DB.prepare([
      "DELETE FROM integration_events",
      "WHERE provider=? AND source_scope=? AND external_event_id=? AND status='received'",
    ].join(" ")).bind(PROVIDER,SCOPE,bucket).run();
  }

  try {
    const result=await sendStagingTestEmail(env,minuteBucket,transport);
    if(!result.accepted){
      await release();
      return json({success:false,message:"Resend rechazó el envío. Revisa que la clave permita enviar desde daurel.com.mx."},502);
    }
    await env.DB.prepare([
      "UPDATE integration_events SET status='completed', processed_at=CURRENT_TIMESTAMP",
      "WHERE provider=? AND source_scope=? AND external_event_id=?",
    ].join(" ")).bind(PROVIDER,SCOPE,bucket).run();
    return json({
      success:true,
      accepted:true,
      recipient:"daurelcontact@gmail.com",
      message:"Resend aceptó el correo. Revisa la bandeja de entrada y spam.",
      not_a_login:true,
    },202);
  } catch {
    // Idempotency-Key igual para este minuto: un fallo ambiguo no produce correos distintos.
    await release();
    return json({success:false,message:"No se pudo confirmar el envío. Comprueba el estado en Resend."},502);
  }
}
