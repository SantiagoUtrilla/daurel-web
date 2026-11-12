// DAUREL V2: interfaz pública de ensayo sin cuenta, SOLO STAGING.
import {guestEnabled} from "./guest-intake.js";

export function guestPageResponse(env){
 const enabled=guestEnabled(env);
 const widget=enabled?'<div class="cf-turnstile" data-sitekey="'+env.TURNSTILE_SITE_KEY+'" data-action="guest_staging"></div>':"";
 const script=enabled?'<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>':"";
 const body=enabled?'<section class="panel"><label for="service">Servicio de prueba</label><select id="service"><option value="general">Orientación general</option><option value="laboral">Orientación laboral</option><option value="civil">Asunto civil</option><option value="contaduria">Orientación contable</option></select><p class="small">Esta prueba no solicita nombres, teléfonos ni documentos personales.</p>'+widget+'<button id="submit" type="button">Crear solicitud sin cuenta</button><p id="result" role="status" aria-live="polite"></p><div id="receipt" hidden><p><strong>Guarda tu código privado de recuperación.</strong> Solo se mostrará una vez y caduca en 24 horas.</p><p id="folio"></p><pre id="code"></pre><a id="claim" href="/v2/client">Verificar correo y recuperar este expediente</a><p class="small">La recuperación también requiere verificar el correo de pruebas daurelcontact@gmail.com. El folio por sí solo no concede acceso.</p></div></section>'
  :'<section class="panel"><strong>El laboratorio sin cuenta todavía no está activado.</strong><p>Para habilitarlo hace falta configurar Turnstile en el Worker de staging. No se ha creado ninguna solicitud.</p></section>';
 const js=enabled?`<script>
(()=>{
 const get=id=>document.getElementById(id);
 let key=null;
 get("service").addEventListener("change",()=>key=null);
 get("submit").addEventListener("click",async()=>{
  get("submit").disabled=true;
  try{
   const token=document.querySelector('[name="cf-turnstile-response"]')?.value||"";
   if(!token)throw Error("Completa la verificación de seguridad.");
   key??=crypto.randomUUID();
   const response=await fetch("/v2/guest/api/create",{
    method:"POST",credentials:"omit",cache:"no-store",
    headers:{"Content-Type":"application/json","Idempotency-Key":key},
    body:JSON.stringify({case_type:get("service").value,turnstile_token:token})
   });
   const data=await response.json();
   if(!response.ok||!data.success)throw Error(data.message||"No se pudo registrar.");
   if(!data.claim_code)throw Error("La solicitud ya existía y el código se entregó una sola vez. Conserva el código del primer intento.");
   key=null;
   get("result").textContent="Solicitud ficticia registrada: "+data.public_folio+".";
   get("receipt").hidden=false;
   get("folio").textContent="Folio: "+data.public_folio;
   get("code").textContent=data.claim_code;
   get("claim").href="/v2/client#invite="+data.claim_code;
   get("submit").disabled=true;
  }catch(e){
   get("result").textContent="No se completó el ensayo: "+e.message;
   get("submit").disabled=false;
  }finally{
   if(window.turnstile&&typeof window.turnstile.reset==="function")window.turnstile.reset();
  }
 });
})();
</script>`:"";
 const html=`<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Solicitud sin cuenta | DAUREL V2</title>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#172535;background:#f6f6f4}*{box-sizing:border-box}
body{margin:0}header{background:#fff;border-bottom:1px solid #e7e7e4;padding:20px max(20px,calc((100vw - 940px)/2))}
header strong{font-family:Georgia,serif;letter-spacing:.08em;font-size:26px}
main{max-width:720px;margin:48px auto;padding:0 22px 48px}h1{font:normal clamp(30px,5vw,46px) Georgia,serif;margin:16px 0}
p{line-height:1.6;color:#536574}.panel{background:white;border:1px solid #e2e5e5;border-radius:12px;padding:28px;margin:24px 0}
label{display:block;margin-bottom:10px;font-weight:650}select{padding:13px;border:1px solid #cbd2d7;border-radius:8px;width:100%;font:inherit}
button{background:#172b3a;color:white;border:0;border-radius:8px;padding:14px 20px;margin-top:18px;cursor:pointer;font-weight:700}
button:disabled{opacity:.6;cursor:wait}.small{font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eaf0f3;padding:14px;border-radius:8px}
a{color:#1a485c}[hidden]{display:none!important}.cf-turnstile{margin-top:17px}
</style>
${script}
</head><body><header><strong>DAUREL</strong> <span style="float:right;font-size:12px;color:#657480">ENTORNO DE PRUEBA</span></header>
<main><p class="small">SOLICITUD GRATUITA · DEMOSTRACIÓN</p><h1>Solicita orientación sin crear una cuenta.</h1>
<p>En este laboratorio solo generamos expedientes ficticios. Podrás recuperar el asunto más adelante verificando tu correo y presentando tu código privado. No necesitas que un administrador autorice cada expediente.</p>
${body}
<p class="small">No introduzcas datos personales ni solicitudes reales. La página pública daurel.com.mx continúa funcionando de manera independiente.</p>
<a href="/v2/client">Ir a mis asuntos</a>
</main>${js}</body></html>`;
 return new Response(html,{headers:{
  "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store",
  "X-Robots-Tag":"noindex,nofollow","Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; style-src 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 }});
}
