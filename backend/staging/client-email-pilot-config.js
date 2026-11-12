// Lista cerrada de direcciones permitidas para el piloto de correos individuales.
// No está diseñado para admitir clientes reales ni habilitarse sin revisión.
import {normalizeEmail} from "./auth-core.js";

export const FIXED_TEST_EMAIL="daurelcontact@gmail.com";

export function clientEmailPilotEnabled(env){
 return env?.ENVIRONMENT==="staging" &&
  env?.STAGING_CLIENT_EMAIL_PILOT_ENABLED==="true" &&
  typeof env?.STAGING_CLIENT_TEST_EMAILS==="string" &&
  typeof env?.TURNSTILE_SITE_KEY==="string" && env.TURNSTILE_SITE_KEY.length>=8 &&
  typeof env?.TURNSTILE_SECRET_KEY==="string" && env.TURNSTILE_SECRET_KEY.length>=20 &&
  typeof env?.AUTH_OTP_HMAC_SECRET==="string" && env.AUTH_OTP_HMAC_SECRET.length>=32 &&
  typeof env?.RESEND_API_KEY==="string" && env.RESEND_API_KEY.length>=10 &&
  env?.AUTH_EMAIL_FROM==="acceso@daurel.com.mx";
}

export function allowedTestEmail(env,value){
 const email=normalizeEmail(value);
 if(!email)return false;
 if(email===FIXED_TEST_EMAIL)return true;
 if(!clientEmailPilotEnabled(env))return false;
 const csv=env.STAGING_CLIENT_TEST_EMAILS;
 if(csv.length>1024)return false;
 const parts=csv.split(",").map(s=>normalizeEmail(s));
 if(parts.length>8||parts.some(s=>!s))return false;
 return parts.includes(email);
}
