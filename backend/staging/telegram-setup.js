// DAUREL V2: prueba EXPLÍCITA de envío a Telegram, SOLO staging.
// Sin revelar secretos de Telegram. Requiere clave técnica en worker.js.
// La prueba puede realizarse antes de activar la tarea diaria. No edita producción.
import {json} from "./demo-api.js";

function respond(data,status=200){
 const r=json(data,status);r.headers.set("X-Robots-Tag","noindex,nofollow");return r;
}
function configured(env){
 return {
  bot:typeof env.DAUREL_V2_TELEGRAM_BOT_TOKEN==="string" &&
   /^[0-9]{6,15}:[A-Za-z0-9_-]{25,}$/.test(env.DAUREL_V2_TELEGRAM_BOT_TOKEN),
  chat:typeof env.DAUREL_V2_TELEGRAM_CHAT_ID==="string" &&
   /^-?[0-9]{5,20}$/.test(env.DAUREL_V2_TELEGRAM_CHAT_ID),
 };
}
export async function telegramConnectionStatus(env){
 if(env.ENVIRONMENT!=="staging")return respond({success:false,message:"Solo staging."},403);
 const c=configured(env);
 return respond({
  success:true,synthetic_only:true,bot_configured:c.bot,chat_configured:c.chat,
  daily_alerts_enabled:env.DAUREL_V2_ALERTS_ENABLED==="true",
  test_message_requires_manual_click:true,
  message:"Ningún mensaje de prueba se enviará hasta pulsar el botón de prueba.",
 });
}
export async function testTelegramConnection(request,env,transport=fetch,now=Date.now()){
 if(env.ENVIRONMENT!=="staging")return respond({success:false,message:"Solo staging."},403);
 if(request.headers.get("Origin")!==new URL(request.url).origin||
    request.body!==null){
  return respond({success:false,message:"Solicitud no permitida."},403);
 }
 const c=configured(env);
 if(!c.bot||!c.chat){
  const missing=[];
  if(!c.bot)missing.push("DAUREL_V2_TELEGRAM_BOT_TOKEN");
  if(!c.chat)missing.push("DAUREL_V2_TELEGRAM_CHAT_ID");
  return respond({
   success:false,message:"Primero configura los secretos de staging: "+missing.join(", ")+".",
  },503);
 }
 const bucket=String(Math.floor(now/60000));
 const ratelimit=await env.DB.prepare([
  "INSERT INTO auth_rate_limits(subject_hash,window_start,attempts)",
  "VALUES('daurel-v2-staging-telegram-probe',?,1)",
  "ON CONFLICT(subject_hash,window_start) DO UPDATE SET attempts=attempts+1",
  "WHERE attempts<1",
 ].join(" ")).bind(bucket).run();
 if(ratelimit.meta?.changes!==1){
  return respond({success:false,message:"Ya se ejecutó una prueba este minuto. Reintenta después."},429);
 }
 try{
  const response=await transport(
   "https://api.telegram.org/bot"+env.DAUREL_V2_TELEGRAM_BOT_TOKEN+"/sendMessage",
   {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
     chat_id:env.DAUREL_V2_TELEGRAM_CHAT_ID,
     text:"DAUREL V2 · Prueba de conexión\n"+
      "Telegram quedó enlazado al entorno de PRUEBAS.\n"+
      "Este mensaje se envió manualmente desde el Centro de operaciones.\n"+
      "Todavía no se han activado los recordatorios diarios.",
     disable_web_page_preview:true,
    })},
  );
  if(!response.ok)return respond({success:false,message:"Telegram rechazó la prueba. Comprueba que abriste el bot y pulsaste Iniciar."},502);
  const payload=await response.json();
  if(payload.ok!==true)return respond({success:false,message:"Telegram no confirmó la recepción."},502);
  return respond({success:true,sent:true,recipient_verified_by_telegram:true,
   daily_alerts_enabled:env.DAUREL_V2_ALERTS_ENABLED==="true",
   message:"Telegram aceptó el mensaje de prueba. Revisa el chat privado del bot."});
 }catch{
  return respond({success:false,message:"No fue posible confirmar el mensaje. Revisa la configuración de Telegram."},502);
 }
}
