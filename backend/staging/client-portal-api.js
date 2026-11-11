// DAUREL V2: portal de CLIENTE SIMULADO, sin contraseña ni clave técnica.
// SOLO Worker staging. El único correo permitido es daurelcontact@gmail.com.
// En producción hará falta Turnstile, verificación de identidad, privacidad y permisos de operadores.
import {json} from "./demo-api.js";
import {
  startPilotLogin,verifyPilotLogin,getPilotSession,logoutPilotSession,
} from "./auth-pilot-api.js";
import {viewPilotInvitedMatters,redeemPilotInvite} from "./invitation-api.js";

const DAY_LIMIT=6;
const TEST_EMAIL="daurelcontact@gmail.com";
const DAY_MS=24*60*60*1000;

function fail(message,status){
 const r=json({success:false,message},status);
 r.headers.set("X-Robots-Tag","noindex,nofollow");
 return r;
}
function sameOriginPost(request){
 // No se permiten escrituras cross-site ni solicitudes sin Origin.
 return request.headers.get("Origin")===new URL(request.url).origin;
}
function configured(env){
 return env.ENVIRONMENT==="staging" && typeof env.AUTH_OTP_HMAC_SECRET==="string" &&
   env.AUTH_OTP_HMAC_SECRET.length>=32 &&
   typeof env.RESEND_API_KEY==="string" && env.RESEND_API_KEY.length>=10 &&
   env.AUTH_EMAIL_FROM==="acceso@daurel.com.mx";
}
function noBody(request){
 // Content-Length puede faltar incluso si el cuerpo está presente.
 return request.body===null;
}

// Puerta de entrada desde navegador para correo FIJO, jamás aceptamos un email enviado por cliente.
export async function portalRequestLogin(request,env,transport=fetch,now=Date.now()){
 if(!sameOriginPost(request)||!noBody(request))
  return fail("Solicitud no permitida.",403);
 if(!configured(env))return fail("Acceso temporalmente no disponible.",503);
 // Restricción adicional al límite de 1/minuto del piloto: máximo 6 correos al día.
 const bucket=String(Math.floor(now/DAY_MS));
 const reserved=await env.DB.prepare([
  "INSERT INTO auth_rate_limits(subject_hash,window_start,attempts)",
  "VALUES('daurel-v2-public-staging-fixed-recipient',?,1)",
  "ON CONFLICT(subject_hash,window_start) DO UPDATE SET attempts=attempts+1",
  "WHERE attempts<?",
 ].join(" ")).bind(bucket,DAY_LIMIT).run();
 if(reserved.meta?.changes!==1){
  return fail("Se alcanzó el límite diario de pruebas de acceso. No es una cuenta pública.",429);
 }
 const response=await startPilotLogin(request,env,transport,now);
 response.headers.set("X-Robots-Tag","noindex,nofollow");
 return response;
}

export async function portalVerifyLogin(request,env,now=Date.now()){
 if(!sameOriginPost(request))return fail("Solicitud no permitida.",403);
 return verifyPilotLogin(request,env,now);
}
export async function portalSession(request,env,now=Date.now()){
 return getPilotSession(request,env,now);
}
export async function portalLogout(request,env,now=Date.now()){
 if(!sameOriginPost(request)||!noBody(request))return fail("Solicitud no permitida.",403);
 return logoutPilotSession(request,env,now);
}
export async function portalMatters(request,env,now=Date.now()){
 return viewPilotInvitedMatters(request,env,now);
}
export async function portalAcceptInvitation(request,env,now=Date.now()){
 if(!sameOriginPost(request))return fail("Solicitud no permitida.",403);
 return redeemPilotInvite(request,env,now);
}
