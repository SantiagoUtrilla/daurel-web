// Pantalla separada: piloto de correos individuales, solo con flag de staging.
// El portal principal conserva el acceso por correo fijo hasta completar pruebas.
import {clientEmailPilotEnabled} from "./client-email-pilot-config.js";
export function clientEmailPilotPage(env){
 if(!clientEmailPilotEnabled(env))return new Response("No disponible",{status:404,
  headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex,nofollow"}});
 const site=env.TURNSTILE_SITE_KEY;
 const html=`<!doctype html><html lang="es-MX"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Correo de prueba | DAUREL V2</title>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#192c39;background:#f6f6f4}
*{box-sizing:border-box}body{margin:0}header{background:white;border-bottom:1px solid #e4e7e8;padding:22px max(18px,calc((100vw - 820px)/2))}
.logo{font:26px Georgia,serif;letter-spacing:.09em}main{max-width:650px;margin:55px auto;padding:0 20px 40px}
h1{font:40px Georgia,serif;line-height:1.15}p{color:#5a6976;line-height:1.6}
section{padding:26px;background:white;border:1px solid #e4e8eb;border-radius:12px;margin:24px 0}
label{font-weight:700;font-size:14px;display:block;margin:18px 0 8px}
input{font:inherit;padding:13px;width:100%;border:1px solid #bbcbd5;border-radius:8px}
button{background:#172b3a;color:white;border:0;border-radius:8px;padding:13px 20px;cursor:pointer;font-weight:bold;margin-top:20px}
button:disabled{opacity:.6}a{color:#1c506e}small{color:#76838b}.status{margin-top:15px;min-height:30px}
</style><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head>
<body><header><span class="logo">DAUREL</span><small style="float:right">ENTORNO DE PRUEBA</small></header>
<main><small>ACCESO INDIVIDUAL · LABORATORIO</small>
<h1>Accede con tu propio correo de prueba.</h1>
<p>Sin contraseña ni aprobación administrativa por cada solicitud. Este ensayo solo permite correos añadidos previamente a la lista de pruebas de DAUREL y no contiene expedientes reales.</p>
<section><div id="start">
<label for="email">Correo de prueba autorizado</label>
<input id="email" type="email" autocomplete="email" placeholder="ejemplo@correo.com" maxlength="254">
<div class="cf-turnstile" data-sitekey="${site}" data-action="client_email_staging"></div>
<button id="send" type="button">Recibir código</button>
</div><div id="verify" hidden>
<p>Revisa tu bandeja de entrada. El código de seis dígitos caduca en 10 minutos.</p>
<label for="otp">Código temporal</label><input id="otp" type="text" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="000000">
<button id="enter" type="button">Verificar y entrar</button>
</div><p class="status" id="status" role="status" aria-live="polite"></p></section>
<a href="/v2/client">Ir al portal de clientes</a>
</main>
<script>
(()=>{
const get=id=>document.getElementById(id);
let challenge=null;
const message=s=>get("status").textContent=s;
async function api(path,data){
 const r=await fetch(path,{method:"POST",credentials:"same-origin",cache:"no-store",
  headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
 const j=await r.json();if(!r.ok||!j.success)throw Error(j.message||"No se pudo continuar.");
 return j;
}
get("send").addEventListener("click",async()=>{
 get("send").disabled=true;
 try{
  const token=document.querySelector('[name="cf-turnstile-response"]')?.value||"";
  if(!token)throw Error("Completa la comprobación de seguridad.");
  const email=get("email").value.trim().toLowerCase();
  if(!email)throw Error("Introduce un correo de prueba.");
  const data=await api("/v2/client/api/email/start",{email,turnstile_token:token});
  challenge=data.challenge_id;get("start").hidden=true;get("verify").hidden=false;
  message("Código enviado al correo de prueba. No compartas los seis dígitos.");
 }catch(e){message(e.message);get("send").disabled=false;
  if(window.turnstile?.reset)window.turnstile.reset();
 }
});
get("enter").addEventListener("click",async()=>{
 get("enter").disabled=true;
 try{
  const code=get("otp").value.trim();
  if(!/^\\d{6}$/.test(code))throw Error("Introduce seis dígitos.");
  await api("/v2/client/api/email/verify",{challenge_id:challenge,code});
  location.replace("/v2/client");
 }catch(e){message(e.message);get("enter").disabled=false}
});
})();
</script></body></html>`;
 return new Response(html,{headers:{
  "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store",
  "X-Robots-Tag":"noindex,nofollow","Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; style-src 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 }});
}
