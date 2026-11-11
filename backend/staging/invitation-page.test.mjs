// Pruebas de interacción de la pantalla. No se envían correos reales.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {invitationPageResponse} from "./invitation-page.js";

async function launch(){
 const html=await (await invitationPageResponse()).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,"script de la pantalla");
 const elements=new Map();
 const lookup=id=>{
  if(!elements.has(id)){
   const e={id,value:"",textContent:"",disabled:id==="verify-otp",hidden:id==="otp-section",
    className:"",listeners:new Map(),children:[],
    addEventListener(name,fn){this.listeners.set(name,fn)},
    focus(){this.focused=true},
    replaceChildren(){this.children=[]},
    appendChild(el){this.children.push(el)},
    append(...args){this.children.push(...args)},
   };
   elements.set(id,e);
  }
  return elements.get(id);
 };
 let authed=false,postVerify=0;
 const fetches=[];
 const api=async(path,options)=>{
  fetches.push({path,options});
  const respond=(data,status=200)=>({ok:status<400,status,json:async()=>data});
  if(path==="/v2/demo/auth/session")
   return respond({success:true,authenticated:authed,session_status:authed?"active":"no_session_cookie"});
  if(path==="/v2/demo/auth/start")
   return respond({success:true,challenge_id:"2fe1d7dc-7ae3-4d6c-a75d-3abf0823d131"});
  if(path==="/v2/demo/auth/verify"){
   const data=JSON.parse(options.body);
   assert.match(data.code,/^\d{6}$/);
   assert.equal(data.challenge_id,"2fe1d7dc-7ae3-4d6c-a75d-3abf0823d131");
   postVerify++;authed=true;
   return respond({success:true,authenticated:true,message:"Correo verificado. Sesión creada sin contraseña."});
  }
  return respond({success:false,message:"Ruta inesperada"},404);
 };
 const sandbox={document:{getElementById:lookup,createElement:tag=>lookup("generated-"+tag)},
  fetch:api,confirm:()=>true};
 vm.runInNewContext(script,sandbox,{timeout:2000});
 lookup("technical").value="token-largo-de-laboratorio-1234567890-9876";
 return {html,lookup,fetches,postVerify:()=>postVerify};
}

test("Pantalla: cinco dígitos NO permiten verificar; deja visible cuántos faltan",async()=>{
 const f=await launch();
 assert.match(f.html,/type="password" maxlength="6" inputmode="numeric"/);
 assert.equal(f.lookup("verify-otp").disabled,true);
 f.lookup("otp").value="53162";
 f.lookup("otp").listeners.get("input")();
 assert.equal(f.lookup("verify-otp").disabled,true);
 assert.match(f.lookup("otp-progress").textContent,/5 de 6 dígitos/);
 assert.match(f.lookup("otp-progress").textContent,/Faltan 1/);
 assert.equal(f.postVerify(),0);
});

test("Pantalla: código con cero inicial preservado y sesión confirmada tras verificar",async()=>{
 const f=await launch();
 await f.lookup("check-session").onclick();
 assert.match(f.lookup("sessionStatus").textContent,/INACTIVA/);
 await f.lookup("send-otp").onclick();
 assert.equal(f.lookup("otp-section").hidden,false);
 assert.equal(f.lookup("otp").focused,true);
 f.lookup("otp").value="053162";
 f.lookup("otp").listeners.get("input")();
 assert.equal(f.lookup("verify-otp").disabled,false);
 assert.match(f.lookup("otp-progress").textContent,/6 de 6 dígitos/);
 await f.lookup("verify-otp").onclick();
 assert.equal(f.postVerify(),1);
 assert.match(f.lookup("sessionStatus").textContent,/Sesión ACTIVA/);
 assert.match(f.lookup("status").textContent,/SESIÓN ACTIVA COMPROBADA/);
 assert.equal(f.lookup("otp-section").hidden,true);
 const sent=f.fetches.find(x=>x.path==="/v2/demo/auth/verify");
 assert.equal(JSON.parse(sent.options.body).code,"053162");
 assert.equal(sent.options.credentials,"same-origin");
});
