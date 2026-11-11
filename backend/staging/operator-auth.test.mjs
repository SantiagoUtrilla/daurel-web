// Identidad de operador V2: SQLite en memoria + correo simulado; sin envíos reales.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {listOperatorTeam,addOperatorMember,changeOperatorMember} from "./operator-team.js";
import {caseAccessSchemaReady} from "./operator-case-access.js";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import worker from "./worker.js";
import {
 operatorStart,operatorVerify,operatorIdentity,operatorStatus,
 operatorLogout,operatorSchemaReady,roleAllows,
} from "./operator-auth.js";

const ORIGIN="https://staging.invalid";
const TECH="token-de-uso-tecnico-local-de-ensayo-2026";
const SECRET="clave-separada-para-firmar-otp-cliente-staging-2026";
const ADMIN_EMAIL="daurelcontact@gmail.com";
const ISO_DATE=new Date();
function fixture(operatorSchema=true,teamSchema=true){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const m of [
  "0001_v2_core.sql","0002_optional_accounts.sql",
  "0003_case_invitations.sql","0004_followup_tasks.sql",
  ...(operatorSchema?["0006_operator_identity.sql",...(teamSchema?["0007_operator_approvals.sql"]:[])]:[]),
 ]){
  sqlite.exec(readFileSync(new URL("../migrations/"+m,import.meta.url),"utf8"));
 }
 function prepared(sql,args=[]){
  return {
   bind:(...vals)=>prepared(sql,vals),
   first:async()=>sqlite.prepare(sql).get(...args)||null,
   all:async()=>({results:sqlite.prepare(sql).all(...args)}),
   run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
  };
 }
 const DB={prepare:sql=>prepared(sql),batch:async list=>{
  sqlite.exec("BEGIN");
  try{
   const out=[];for(const q of list)out.push(await q.run());
   sqlite.exec("COMMIT");return out;
  }catch(e){sqlite.exec("ROLLBACK");throw e}
 }};
 const env={
  ENVIRONMENT:"staging",DB,STAGING_TEST_TOKEN:TECH,
  AUTH_OTP_HMAC_SECRET:SECRET,
  RESEND_API_KEY:"re_fake-test-only-123456",
  AUTH_EMAIL_FROM:"acceso@daurel.com.mx",
 };
 sqlite.prepare(
  "INSERT INTO channel_accounts(channel_account_id,provider,provider_account_id) VALUES ('daurel-v2-demo','staging','test')"
 ).run();
 sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES ('p1','person')").run();
 sqlite.prepare(
  "INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id) VALUES ('i1','p1','daurel-v2-demo','demo-cliente1')"
 ).run();
 sqlite.prepare(
  "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel) VALUES ('11111111-1111-4111-8111-111111111111','DAU-TEST-ADMIN','p1','Solicitud ficticia de pruebas','staging_demo')"
 ).run();
 return {sqlite,env};
}
function make(path,method="GET",body=undefined,extra={}){
 const headers={...extra};
 if(method==="POST")headers.Origin??=ORIGIN;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request(ORIGIN+path,{
  method,headers,body:body===undefined?undefined:JSON.stringify(body),
 });
}
function tech(){return {Authorization:"Bearer "+TECH}}
function providerCapture(){
 let code;
 const transport=async(url,init)=>{
  assert.equal(url,"https://api.resend.com/emails");
  const payload=JSON.parse(init.body);
  assert.deepEqual(payload.to,[ADMIN_EMAIL]);
  assert.equal(payload.subject,"Código administrativo de DAUREL V2");
  code=/Tu código temporal es: (\d{6})/.exec(payload.text)?.[1];
  assert.match(code,/^\d{6}$/);
  return {ok:true};
 };
 return {transport,get code(){return code}};
}
async function enroll(f,now=Date.now()){
 const sent=providerCapture();
 const start=await operatorStart(make("/v2/operator/auth/setup/start","POST",undefined,tech()),f.env,sent.transport,now);
 assert.equal(start.status,202);
 const challenge=(await start.json()).challenge_id;
 const answer=await operatorVerify(make("/v2/operator/auth/verify","POST",
  {challenge_id:challenge,code:sent.code},tech()),f.env,now+500);
 assert.equal(answer.status,200);
 const cookie=answer.headers.get("Set-Cookie").split(";")[0];
 return {cookie,challenge};
}

test("Sin 0006, laboratorio antiguo sigue utilizable y panel informa falta del esquema",async()=>{
 const f=fixture(false);
 assert.equal(await operatorSchemaReady(f.env),false);
 const status=await (await worker.fetch(make("/v2/operator/auth/status"),f.env)).json();
 assert.equal(status.schema_ready,false);
 assert.equal(status.enrolled,false);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,tech()),f.env)).status,200);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue"),f.env)).status,401);
 const html=await (await worker.fetch(make("/v2/operator"),f.env)).text();
 assert.match(html,/Acceso de administrador/);
 assert.match(html,/Primera activación/);
 assert.match(html,/admin-otp/);
 assert.equal((await worker.fetch(make("/health"),f.env)).status,200);
 assert.equal((await (await worker.fetch(make("/health"),f.env)).json()).optional_operator_schema.ready,false);
});

test("Alta inicial: exige clave técnica Y código de correo, por única vez",async()=>{
 const f=fixture(),now=Date.now();
 const status=await (await worker.fetch(make("/v2/operator/auth/status"),f.env)).json();
 assert.equal(status.schema_ready,true);
 assert.equal(status.enrolled,false);
 assert.equal((await worker.fetch(make("/v2/operator/auth/start","POST"),f.env)).status,409);
 assert.equal((await worker.fetch(make("/v2/operator/auth/setup/start","POST"),f.env)).status,401);
 assert.equal((await worker.fetch(make("/v2/operator/auth/setup/start","POST",undefined,{
  Origin:"https://malicioso.invalid",...tech(),
 }),f.env)).status,403);
 const sent=providerCapture();
 const started=await operatorStart(make("/v2/operator/auth/setup/start","POST",undefined,tech()),f.env,sent.transport,now);
 assert.equal(started.status,202);
 const result=await started.json();
 assert.ok(!JSON.stringify(result).includes(sent.code));
 const payload={challenge_id:result.challenge_id,code:sent.code};
 assert.equal((await worker.fetch(make("/v2/operator/auth/verify","POST",payload),f.env)).status,401);
 const invalid=await operatorVerify(make("/v2/operator/auth/verify","POST",
  {...payload,code:sent.code==="999999"?"000000":"999999"},tech()),f.env,now+50);
 assert.equal(invalid.status,401);
 const verified=await operatorVerify(make("/v2/operator/auth/verify","POST",payload,tech()),f.env,now+100);
 assert.equal(verified.status,200);
 const cookie=verified.headers.get("Set-Cookie");
 assert.match(cookie,/^__Host-daurel_v2_operator=/);
 assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 assert.ok(!cookie.includes(sent.code));
 assert.equal((await verified.json()).role,"owner");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_memberships").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_sessions").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_request_access").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_party_access").get().n,0);
 assert.equal((await operatorVerify(make("/v2/operator/auth/verify","POST",payload,tech()),f.env,now+150)).status,401);
 assert.equal((await worker.fetch(make("/v2/operator/auth/setup/start","POST",undefined,tech()),f.env)).status,409);
});

test("Administrador: cookie propia abre bandeja, cliente y clave técnica ya no",async()=>{
 const f=fixture(),{cookie}=await enroll(f);
 const path="/v2/operator/api/queue";
 const who=await (await worker.fetch(make("/v2/operator/auth/status","GET",undefined,{Cookie:cookie}),f.env)).json();
 assert.equal(who.authenticated,true);
 assert.equal(who.role,"owner");
 assert.equal(who.email,ADMIN_EMAIL);
 assert.equal((await worker.fetch(make(path,"GET",undefined,{Cookie:cookie}),f.env)).status,200);
 assert.equal((await worker.fetch(make(path,"GET",undefined,tech()),f.env)).status,401);
 assert.equal((await worker.fetch(make(path,"GET",undefined,{Cookie:"__Host-daurel_v2_pilot="+cookie.split("=")[1]}),f.env)).status,401);
 assert.equal((await worker.fetch(make(path),f.env)).status,401);
 const create=await worker.fetch(make("/v2/operator/api/create","POST",
  {client_key:"demo-cliente1",case_type:"laboral"},
  {Cookie:cookie,"Idempotency-Key":"owner-only-create-1"}),f.env);
 assert.equal(create.status,201);
 const requestId=(await create.json()).request_id;
 const history=await worker.fetch(make("/v2/operator/api/history/"+requestId,"GET",undefined,{Cookie:cookie}),f.env);
 assert.equal(history.status,200);
 assert.equal((await history.json()).events.length,1);
 const blocked=await worker.fetch(make("/v2/operator/api/create","POST",
  {client_key:"demo-cliente1",case_type:"civil"},
  {Origin:"https://atacante.invalid",Cookie:cookie,"Idempotency-Key":"owner-only-create-2"}),f.env);
 assert.equal(blocked.status,403);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_access_audit WHERE event_type='operator_action'").get().n,1);
});

test("Cerrar sesión administrativa revoca acceso; sesión del cliente se mantiene separada",async()=>{
 const f=fixture(),{cookie}=await enroll(f);
 const logged=await worker.fetch(make("/v2/operator/auth/logout","POST",undefined,{Cookie:cookie}),f.env);
 assert.equal(logged.status,200);
 assert.match(logged.headers.get("Set-Cookie"),/Max-Age=0/);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env)).status,401);
 assert.equal((await worker.fetch(make("/v2/operator/auth/status","GET",undefined,{Cookie:cookie}),f.env)).status,200);
 assert.equal((await (await operatorStatus(make("/v2/operator/auth/status","GET",undefined,{Cookie:cookie}),f.env)).json()).authenticated,false);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_access_audit WHERE event_type='operator_logout'").get().n,1);
});

test("Segundo acceso usa solo correo OTP y 4 horas de expiración",async()=>{
 const f=fixture();
 const {cookie:first}=await enroll(f);
 const now=Date.now()+61*1000;
 const sent=providerCapture();
 const start=await operatorStart(make("/v2/operator/auth/start","POST"),f.env,sent.transport,now);
 assert.equal(start.status,202);
 const challenge=(await start.json()).challenge_id;
 const verify=await operatorVerify(make("/v2/operator/auth/verify","POST",
  {challenge_id:challenge,code:sent.code}),f.env,now+100);
 assert.equal(verify.status,200);
 const cookie=verify.headers.get("Set-Cookie").split(";")[0];
 assert.notEqual(first,cookie);
 assert.equal((await operatorStatus(make("/v2/operator/auth/status","GET",undefined,{Cookie:cookie}),f.env,now+1000)).status,200);
 assert.ok(await operatorIdentity(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env,now+4*60*60*1000-600));
 assert.equal(await operatorIdentity(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env,now+4*60*60*1000+2000),null);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_sessions").get().n,2);
});

test("Seguridad: cambiar el rol propietario manualmente no permite suplantar un lector",async()=>{
 const f=fixture(),{cookie}=await enroll(f);
 f.sqlite.prepare("UPDATE operator_memberships SET role='reader'").run();
 assert.equal(roleAllows("reader","/v2/operator/api/queue","GET"),true);
 assert.equal(roleAllows("reader","/v2/operator/api/create","POST"),false);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env)).status,401);
 assert.equal((await worker.fetch(make("/v2/operator/api/create","POST",
  {client_key:"demo-cliente1",case_type:"civil"},
  {Cookie:cookie,"Idempotency-Key":"reader-not-allowed"}),f.env)).status,401);
 assert.equal((await worker.fetch(make("/v2/operator/api/telegram/status","GET",undefined,{Cookie:cookie}),f.env)).status,401);
 f.sqlite.prepare("UPDATE operator_memberships SET status='disabled',revoked_at=CURRENT_TIMESTAMP").run();
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env)).status,401);
});

test("Códigos administradores son de uso único, 5 intentos y 6 envíos diarios",async()=>{
 const f=fixture(),now=Date.parse("2026-11-11T20:00:01Z");
 const sent=providerCapture();
 const initial=await operatorStart(make("/v2/operator/auth/setup/start","POST",undefined,tech()),f.env,sent.transport,now);
 const id=(await initial.json()).challenge_id;
 for(let i=0;i<5;i++){
  const code=sent.code==="111111"?"222222":"111111";
  assert.equal((await operatorVerify(make("/v2/operator/auth/verify","POST",
   {challenge_id:id,code},tech()),f.env,now+i+100)).status,401);
 }
 assert.equal((await operatorVerify(make("/v2/operator/auth/verify","POST",
  {challenge_id:id,code:sent.code},tech()),f.env,now+200)).status,401);
 let sentCount=1;
 for(let i=1;i<6;i++){
  const t=now+i*61*1000;
  const r=await operatorStart(make("/v2/operator/auth/setup/start","POST",undefined,tech()),f.env,
   async()=>{sentCount++;return {ok:true}},t);
  assert.equal(r.status,202);
 }
 const last=await operatorStart(make("/v2/operator/auth/setup/start","POST",undefined,tech()),f.env,
  async()=>{throw Error("No enviar más")},now+6*61*1000);
 assert.equal(last.status,429);
 assert.equal(sentCount,6);
});

test("Contexto de seguridad: sin permiso administrativo en entornos ajenos a staging",async()=>{
 const f=fixture();
 const wrongEnv={...f.env,ENVIRONMENT:"production"};
 assert.equal((await worker.fetch(make("/v2/operator/auth/status"),wrongEnv)).status,403);
 assert.equal((await operatorStart(make("/v2/operator/auth/setup/start","POST",undefined,tech()),wrongEnv,
  async()=>{throw Error("no mail")},Date.now())).status,503);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,tech()),wrongEnv)).status,403);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,tech()),f.env)).status,200);
});


test("Pantalla administrativa compilable: los scripts integrados no tienen errores de sintaxis",async()=>{
 const f=fixture();
 const response=await worker.fetch(make("/v2/operator"),f.env);
 assert.equal(response.status,200);
 const html=await response.text();
 const match=/<script>([\s\S]*?)<\/script>/.exec(html);
 assert.ok(match,"script del panel");
 assert.doesNotThrow(()=>new vm.Script(match[1],{filename:"daurel-v2-operator-ui.js"}));
 assert.match(html,/id="admin-access"/);
 assert.match(html,/id="admin-setup-send"/);
 assert.match(html,/id="admin-verify"/);
 assert.match(html,/id="admin-logout"/);
 assert.match(html,/\/v2\/operator\/api\/create/);
 assert.match(html,/\/v2\/operator\/api\/history\//);
});


test("Pantalla: error al activar se muestra EN EL PANEL visible (regresión)",async()=>{
 const f=fixture();
 const html=await (await worker.fetch(make("/v2/operator"),f.env)).text();
 const source=/<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
 assert.ok(source);
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id)){
   nodes.set(id,{
    id,value:"",hidden:false,disabled:false,textContent:"",className:"",
    style:{},events:{},children:[],replaceChildren(){this.children=[]},
    append(){},setAttribute(){},focus(){},
    addEventListener(type,callback){this.events[type]=callback},
   });
  }
  return nodes.get(id);
 };
 const requests=[];
 const mockFetch=async(path,opts)=>{
  requests.push({path,opts});
  if(path==="/v2/operator/auth/status")
   return {ok:true,status:200,json:async()=>({
    success:true,schema_ready:true,enrolled:false,authenticated:false,
    message:"Primera activación: clave técnica y código de correo.",
   })};
  if(path==="/v2/operator/auth/setup/start")
   return {ok:false,status:401,json:async()=>({
    success:false,message:"Clave técnica de primera activación incorrecta.",
   })};
  throw Error("Solicitud de red inesperada: "+path);
 };
 vm.runInNewContext(source,{
  document:{getElementById:element,addEventListener(){}},
  fetch:mockFetch,crypto:globalThis.crypto,
  console,confirm:()=>true,
 },{filename:"daurel-operator-ui-regression.js"});
 await new Promise(resolve=>setImmediate(resolve)); // authState inicial
 assert.equal(element("legacy-login").hidden,true);
 assert.equal(element("admin-access").hidden,false);
 assert.equal(element("admin-setup").hidden,false);
 element("enroll-key").value=TECH;
 assert.equal(typeof element("admin-setup-send").events.click,"function");
 await element("admin-setup-send").events.click();
 assert.equal(requests.at(-1).path,"/v2/operator/auth/setup/start");
 assert.equal(requests.at(-1).opts.method,"POST");
 assert.equal(requests.at(-1).opts.body,"{}");
 assert.equal(requests.at(-1).opts.headers["Content-Type"],"application/json");
 assert.match(element("admin-status").textContent,/Clave técnica de primera activación incorrecta/);
 assert.equal(element("admin-status").style.color,"#9b2635");
 assert.equal(element("legacy-login").hidden,true);
});


test("Chrome: activación con JSON {} explícito envía OTP correctamente",async()=>{
 const f=fixture(),now=Date.now(),mail=providerCapture();
 const req=make("/v2/operator/auth/setup/start","POST",{},tech());
 assert.equal(req.body!==null,true);
 const started=await operatorStart(req,f.env,mail.transport,now);
 assert.equal(started.status,202);
 const {challenge_id}=await started.json();
 const verified=await operatorVerify(make("/v2/operator/auth/verify","POST",{
  challenge_id,code:mail.code,
 },tech()),f.env,now+100);
 assert.equal(verified.status,200);
 const cookie=verified.headers.get("Set-Cookie").split(";")[0];
 const logout=await operatorLogout(make("/v2/operator/auth/logout","POST",{},
  {Cookie:cookie}),f.env,now+250);
 assert.equal(logout.status,200);
 assert.equal((await logout.json()).authenticated,false);
 assert.equal((await operatorIdentity(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env,now+400)),null);
});

test("Cloudflare: POST con stream vacío permite activar; POST con datos extra no",async()=>{
 const f=fixture(),now=Date.now(),mail=providerCapture();
 const path="/v2/operator/auth/setup/start";
 const req=new Request(ORIGIN+path,{
  method:"POST",
  headers:{Origin:ORIGIN,Authorization:"Bearer "+TECH},
  body:"",
 });
 assert.equal(req.body!==null,true);
 const started=await operatorStart(req,f.env,mail.transport,now);
 assert.equal(started.status,202);
 assert.equal((await started.json()).success,true);
 const invalid=await operatorStart(make(path,"POST",{extra:"malicioso"},tech()),f.env,
  async()=>{throw Error("No enviar correo");},now+61000);
 assert.equal(invalid.status,400);
 assert.match((await invalid.json()).message,/Formato/);
});

test("Protección CSRF: Referer de mismo origen solo se acepta con Sec-Fetch-Site, nunca cross-site",async()=>{
 const now=Date.now(),path="/v2/operator/auth/setup/start";
 const ref=ORIGIN+"/v2/operator?utm_source=chatgpt.com";
 const check=async headers=>{
  const f=fixture();
  return operatorStart(new Request(ORIGIN+path,{method:"POST",headers,body:"{}"}),
   f.env,providerCapture().transport,now);
 };
 const allowed=await check({
  Authorization:"Bearer "+TECH,"Content-Type":"application/json",
  Referer:ref,"Sec-Fetch-Site":"same-origin",
 });
 assert.equal(allowed.status,202);
 const refused=await check({
  Authorization:"Bearer "+TECH,"Content-Type":"application/json",
  Referer:ref,"Sec-Fetch-Site":"cross-site",
 });
 assert.equal(refused.status,403);
 assert.match((await refused.json()).message,/Origen/);
 const attack=await check({
  Authorization:"Bearer "+TECH,"Content-Type":"application/json",
  Origin:"https://evil.invalid",Referer:ref,"Sec-Fetch-Site":"same-origin",
 });
 assert.equal(attack.status,403);
});


test("Regresión Cloudflare: Content-Length 2 real en POST '{}' permite alta de administrador",async()=>{
 const f=fixture(),now=Date.now(),mail=providerCapture();
 const request=new Request(ORIGIN+"/v2/operator/auth/setup/start",{
  method:"POST",
  headers:{
   Origin:ORIGIN,
   "Sec-Fetch-Site":"same-origin",
   Referer:ORIGIN+"/v2/operator?utm_source=chatgpt.com",
   Authorization:"Bearer "+TECH,
   "Content-Type":"application/json",
   "Content-Length":"2",
  },
  body:"{}",
 });
 assert.equal(request.headers.get("Content-Length"),"2");
 const started=await operatorStart(request,f.env,mail.transport,now);
 assert.equal(started.status,202,await started.clone().text());
 const challenge=(await started.json()).challenge_id;
 assert.match(mail.code,/^\d{6}$/);
 const verified=await operatorVerify(make("/v2/operator/auth/verify","POST",{
  challenge_id:challenge,code:mail.code,
 },tech()),f.env,now+200);
 assert.equal(verified.status,200);
 assert.match(verified.headers.get("Set-Cookie"),/__Host-daurel_v2_operator=/);
});

test("Content-Length validado como número: rechaza tamaños manipulados o excesivos",async()=>{
 const f=fixture(),now=Date.now();
 const attack=async length=>operatorStart(new Request(ORIGIN+"/v2/operator/auth/setup/start",{
  method:"POST",
  headers:{
   Origin:ORIGIN,Authorization:"Bearer "+TECH,
   "Content-Type":"application/json","Content-Length":length,
  },body:"{}",
 }),f.env,async()=>{throw Error("No debe enviar");},now);
 for(const len of ["2x","-1","99","1e4"]){
  const answer=await attack(len);
  assert.equal(answer.status,400,len);
  assert.match((await answer.json()).message,/Formato/);
 }
 const valid=await operatorStart(new Request(ORIGIN+"/v2/operator/auth/setup/start",{
  method:"POST",headers:{
   Origin:ORIGIN,Authorization:"Bearer "+TECH,"Content-Type":"application/json",
   "Content-Length":"2",
  },body:"{}",
 }),f.env,providerCapture().transport,now);
 assert.equal(valid.status,202);
});


test("Ruta real del Worker: POST de Chrome con Content-Length 2 llega a comprobar la clave técnica",async()=>{
 const f=fixture();
 const request=new Request(ORIGIN+"/v2/operator/auth/setup/start",{
  method:"POST",
  headers:{
   "Origin":ORIGIN,"Sec-Fetch-Site":"same-origin",
   "Referer":ORIGIN+"/v2/operator?utm_source=chatgpt.com",
   "Authorization":"Bearer NO_ES_CLAVE_VALIDA",
   "Content-Type":"application/json",
   "Content-Length":"2",
  },
  body:"{}",
 });
 // La ruta NO debe devolver 400 (formato). Debe llegar a la verificación
 // del secreto técnico y fallar únicamente por la clave deliberadamente falsa.
 const response=await worker.fetch(request,f.env);
 assert.equal(response.status,401);
 assert.match((await response.json()).message,/Clave técnica de primera activación incorrecta/);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_login_challenges").get().n,0);
});


test("Bitácora owner: muestra accesos y acciones confirmadas sin mostrar datos privados",async()=>{
 const f=fixture(),{cookie}=await enroll(f);
 const path="/v2/operator/api/audit";
 const response=await worker.fetch(make(path,"GET",undefined,{Cookie:cookie}),f.env);
 assert.equal(response.status,200);
 assert.equal(response.headers.get("Cache-Control"),"no-store");
 const initial=await response.json();
 assert.equal(initial.success,true);
 assert.equal(initial.synthetic_only,true);
 assert.ok(initial.events.some(e=>e.event_type==="owner_enrolled"));
 assert.ok(initial.events.some(e=>e.event_type==="operator_login"));
 assert.ok(initial.events.every(e=>e.operator_email===ADMIN_EMAIL));
 assert.ok(initial.events.every(e=>!Object.hasOwn(e,"account_id")));
 assert.ok(initial.events.every(e=>!Object.hasOwn(e,"session_id")));
 assert.ok(!JSON.stringify(initial).includes(TECH));
 assert.ok(!JSON.stringify(initial).includes(SECRET));
 // La bitácora registra también una operación confirmada, no su contenido.
 const created=await worker.fetch(make("/v2/operator/api/create","POST",
  {client_key:"demo-cliente1",case_type:"laboral"},
  {Cookie:cookie,"Idempotency-Key":"audit-create-0001"}),f.env);
 assert.equal(created.status,201);
 const updated=await (await worker.fetch(make(path,"GET",undefined,{Cookie:cookie}),f.env)).json();
 const item=updated.events.find(e=>e.event_type==="operator_action");
 assert.ok(item);
 assert.equal(item.operation,"POST /v2/operator/api/create");
 assert.ok(!JSON.stringify(updated).includes("Solicitud ficticia de pruebas"));
 assert.ok(!JSON.stringify(updated).includes("demo-cliente1"));
 assert.ok(updated.events.length<=50);
 const html=await (await worker.fetch(make("/v2/operator"),f.env)).text();
 assert.match(html,/id="operator-audit"/);
 assert.match(html,/Actualizar bitácora/);
 assert.match(html,/role/);
});

test("Bitácora no se abre con cookie de cliente, clave técnica ni rol reader/manager",async()=>{
 const f=fixture(),{cookie}=await enroll(f),path="/v2/operator/api/audit";
 const clientCookie="__Host-daurel_v2_pilot="+cookie.split("=")[1];
 assert.equal((await worker.fetch(make(path,"GET",undefined,{Cookie:clientCookie}),f.env)).status,401);
 assert.equal((await worker.fetch(make(path,"GET",undefined,tech()),f.env)).status,401);
 assert.equal((await worker.fetch(make(path),f.env)).status,401);
 for(const role of ["reader","manager"]){
  f.sqlite.prepare("UPDATE operator_memberships SET role=?").run(role);
  assert.equal((await worker.fetch(make(path,"GET",undefined,{Cookie:cookie}),f.env)).status,401,role);
  assert.equal(roleAllows(role,path,"GET"),false);
 }
 f.sqlite.prepare("UPDATE operator_memberships SET role='owner'").run();
 assert.equal((await worker.fetch(make(path,"GET",undefined,{Cookie:cookie}),f.env)).status,200);
 assert.equal(roleAllows("owner",path,"GET"),true);
 assert.equal(roleAllows("owner",path,"POST"),false);
 f.sqlite.prepare("UPDATE operator_memberships SET status='disabled'").run();
 assert.equal((await worker.fetch(make(path,"GET",undefined,{Cookie:cookie}),f.env)).status,401);
});

test("Bitácora en staging: antes de instalar el módulo administrativo no acepta clave de pruebas",async()=>{
 const f=fixture(false);
 const result=await worker.fetch(make("/v2/operator/api/audit","GET",undefined,tech()),f.env);
 assert.equal(result.status,403);
 assert.equal((await result.json()).success,false);
 const otherEnv=fixture();
 assert.equal((await worker.fetch(make("/v2/operator/api/audit","GET",undefined,tech()),
  {...otherEnv.env,ENVIRONMENT:"production"})).status,403);
});


test("Equipo: propietario autoriza correo individual y no envía mensajes sin solicitud",async()=>{
 const f=fixture(),{cookie}=await enroll(f);
 const team=await worker.fetch(make("/v2/operator/api/team/list","GET",undefined,{Cookie:cookie}),f.env);
 assert.equal(team.status,200);
 assert.deepEqual((await team.json()).team,[]);
 const add=await worker.fetch(make("/v2/operator/api/team/add","POST",{
  email:"PERSONA.PRUEBA@example.invalid",role:"reader",
 },{Cookie:cookie}),f.env);
 assert.equal(add.status,201);
 const added=await add.json();
 assert.equal(added.email,"persona.prueba@example.invalid");
 assert.equal(added.role,"reader");
 const listing=await (await worker.fetch(make("/v2/operator/api/team/list","GET",undefined,{Cookie:cookie}),f.env)).json();
 assert.equal(listing.team.length,1);
 assert.equal(listing.team[0].verified,false);
 assert.equal(listing.team[0].status,"active");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_sessions").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_request_access").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_party_access").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_access_audit WHERE operation LIKE 'TEAM_AUTHORIZE%'").get().n,1);
 assert.equal((await worker.fetch(make("/v2/operator/api/team/add","POST",{
  email:"persona.prueba@example.invalid",role:"reader",
 },{Cookie:cookie}),f.env)).status,409);
});

test("Equipo: gestor aprobado inicia sesión con SU correo, nunca con clave del dueño",async()=>{
 const f=fixture(),{cookie:owner}=await enroll(f);
 const email="gestor@example.invalid";
 const add=await worker.fetch(make("/v2/operator/api/team/add","POST",{email,role:"manager"},
  {Cookie:owner}),f.env);
 assert.equal(add.status,201);
 const destination=await f.env.DB.prepare("SELECT verified_at FROM account_emails WHERE email_normalized=?").bind(email).first();
 assert.equal(destination,null); // Todavía NO existe cuenta de correo verificada
 const sent={code:null,recipient:null};
 const mockMail=async(url,init)=>{
  assert.equal(url,"https://api.resend.com/emails");
  const payload=JSON.parse(init.body);
  sent.recipient=payload.to[0];
  sent.code=/Tu código temporal es: (\d{6})/.exec(payload.text)?.[1];
  assert.equal(payload.subject,"Código administrativo de DAUREL V2");
  return {ok:true};
 };
 const now=Date.now()+61000;
 const start=await operatorStart(make("/v2/operator/auth/start","POST",{email}),f.env,mockMail,now);
 assert.equal(start.status,202);
 assert.equal(sent.recipient,email);
 assert.match(sent.code,/^\d{6}$/);
 const code=(await start.json()).challenge_id;
 assert.equal((await operatorVerify(make("/v2/operator/auth/verify","POST",{challenge_id:code,code:"000000"}),f.env,now+50)).status,401);
 const verify=await operatorVerify(make("/v2/operator/auth/verify","POST",{challenge_id:code,code:sent.code}),f.env,now+100);
 assert.equal(verify.status,200);
 assert.equal((await verify.json()).role,"manager");
 const memberCookie=verify.headers.get("Set-Cookie").split(";")[0];
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:memberCookie}),f.env)).status,200);
 assert.equal((await worker.fetch(make("/v2/operator/api/team/list","GET",undefined,{Cookie:memberCookie}),f.env)).status,403);
 assert.equal((await worker.fetch(make("/v2/operator/api/audit","GET",undefined,{Cookie:memberCookie}),f.env)).status,403);
 assert.equal((await worker.fetch(make("/v2/operator/api/telegram/status","GET",undefined,{Cookie:memberCookie}),f.env)).status,403);
 assert.equal((await f.env.DB.prepare("SELECT verified_at FROM account_emails WHERE email_normalized=?").bind(email).first()).verified_at!==null,true);
 const ownerStill=(await (await worker.fetch(make("/v2/operator/auth/status","GET",undefined,{Cookie:owner}),f.env)).json());
 assert.equal(ownerStill.role,"owner");
});

test("Equipo: desactivar revoca sesión inmediatamente; correo desactivado no recibe más OTP",async()=>{
 const f=fixture(),{cookie:owner}=await enroll(f);
 const email="revocable@example.invalid";
 const created=await addOperatorMember(make("/v2/operator/api/team/add","POST",
  {email,role:"manager"}),f.env,await operatorIdentity(make("/v2/operator/api/queue","GET",undefined,{Cookie:owner}),f.env));
 assert.equal(created.status,201);
 const id=(await created.json()).account_id;
 let code=null;
 const now=Date.now()+60000;
 const sent=await operatorStart(make("/v2/operator/auth/start","POST",{email}),f.env,async(_,init)=>{
  code=/Tu código temporal es: (\d{6})/.exec(JSON.parse(init.body).text)?.[1];
  return {ok:true};
 },now);
 assert.equal(sent.status,202);
 const challenge=(await sent.json()).challenge_id;
 const verified=await operatorVerify(make("/v2/operator/auth/verify","POST",{challenge_id:challenge,code}),f.env,now+250);
 assert.equal(verified.status,200);
 const personal=verified.headers.get("Set-Cookie").split(";")[0];
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:personal}),f.env)).status,200);
 const disabled=await worker.fetch(make("/v2/operator/api/team/change","POST",{
  account_id:id,role:"reader",status:"disabled",
 },{Cookie:owner}),f.env);
 assert.equal(disabled.status,200);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:personal}),f.env)).status,401);
 assert.equal(f.sqlite.prepare("SELECT revoked_at FROM operator_sessions WHERE account_id=?").get(id).revoked_at!==null,true);
 const rejected=await operatorStart(make("/v2/operator/auth/start","POST",{email}),f.env,
  async()=>{throw Error("No enviar OTP de suspendido");},now+61000);
 assert.equal(rejected.status,403);
 const restored=await changeOperatorMember(make("/v2/operator/api/team/change","POST",{
  account_id:id,role:"reader",status:"active",
 }),f.env,await operatorIdentity(make("/v2/operator/api/queue","GET",undefined,{Cookie:owner}),f.env));
 assert.equal(restored.status,200);
 const newMail={code:null};
 const newStart=await operatorStart(make("/v2/operator/auth/start","POST",{email}),f.env,async(_,init)=>{
  newMail.code=/Tu código temporal es: (\d{6})/.exec(JSON.parse(init.body).text)?.[1];
  return {ok:true};
 },now+122000);
 assert.equal(newStart.status,202);
 const readerLogin=await operatorVerify(make("/v2/operator/auth/verify","POST",{
  challenge_id:(await newStart.json()).challenge_id,code:newMail.code,
 }),f.env,now+123000);
 assert.equal((await readerLogin.json()).role,"reader");
 const readerCookie=readerLogin.headers.get("Set-Cookie").split(";")[0];
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:readerCookie}),f.env)).status,200);
 assert.equal((await worker.fetch(make("/v2/operator/api/create","POST",{
  client_key:"demo-cliente1",case_type:"civil"
 },{Cookie:readerCookie,"Idempotency-Key":"reader-denied-new"}),f.env)).status,403);
});

test("Equipo: no se puede agregar propietario, elevar roles ni editar desde cliente o clave técnica",async()=>{
 const f=fixture(),{cookie:owner}=await enroll(f);
 const listPath="/v2/operator/api/team/list";
 assert.equal((await worker.fetch(make(listPath,"GET",undefined,tech()),f.env)).status,401);
 assert.equal((await worker.fetch(make(listPath,"GET",undefined,{
  Cookie:"__Host-daurel_v2_pilot="+owner.split("=")[1],
 }),f.env)).status,401);
 assert.equal((await worker.fetch(make("/v2/operator/api/team/add","POST",{
  email:"daurelcontact@gmail.com",role:"reader",
 },{Cookie:owner}),f.env)).status,400);
 for(const role of ["owner","admin","superuser",""]){
  const r=await worker.fetch(make("/v2/operator/api/team/add","POST",{
   email:"persona@example.invalid",role,
  },{Cookie:owner}),f.env);
  assert.equal(r.status,400,role);
 }
 assert.equal((await worker.fetch(make("/v2/operator/api/team/add","POST",{
  email:"colab@example.invalid",role:"reader",
 },{Cookie:owner,Origin:"https://evil.invalid"}),f.env)).status,403);
 const id=(await (await worker.fetch(make("/v2/operator/api/team/add","POST",{
  email:"colab@example.invalid",role:"reader",
 },{Cookie:owner}),f.env)).json()).account_id;
 const self=f.sqlite.prepare("SELECT account_id FROM operator_memberships WHERE role='owner'").get().account_id;
 assert.equal((await worker.fetch(make("/v2/operator/api/team/change","POST",{
  account_id:self,role:"reader",status:"disabled",
 },{Cookie:owner}),f.env)).status,400);
 assert.equal((await worker.fetch(make("/v2/operator/api/team/change","POST",{
  account_id:id,role:"owner",status:"active",
 },{Cookie:owner}),f.env)).status,400);
 assert.equal(f.sqlite.prepare("SELECT role,status FROM operator_memberships WHERE account_id=?").get(self).role,"owner");
 assert.equal(f.sqlite.prepare("SELECT role,status FROM operator_memberships WHERE account_id=?").get(id).role,"reader");
});

test("Equipo: correo no autorizado no puede obtener código ni activar membresía",async()=>{
 const f=fixture();
 await enroll(f);
 const never=await operatorStart(make("/v2/operator/auth/start","POST",{
  email:"no-autorizado@example.invalid",
 }),f.env,async()=>{throw Error("No se debe enviar un mensaje");},Date.now()+60000);
 assert.equal(never.status,403);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_login_challenges WHERE email_normalized=?").get("no-autorizado@example.invalid").n,0);
 const html=await (await worker.fetch(make("/v2/operator"),f.env)).text();
 assert.match(html,/Administrar colaboradores/);
 assert.match(html,/id="operator-email"/);
 assert.match(html,/id="team-add"/);
 assert.match(html,/\/v2\/operator\/api\/team\/list/);
});


test("Staging 0006 sin instalar 0007: administrador sigue entrando, colaboradores esperan activación",async()=>{
 const f=fixture(true,false);
 const {cookie}=await enroll(f);
 const health=(await (await worker.fetch(make("/health"),f.env)).json());
 assert.equal(health.optional_operator_schema.ready,true);
 assert.equal(health.optional_team_schema.ready,false);
 assert.deepEqual(health.optional_team_schema.missing_tables,["operator_approved_emails"]);
 const session=await (await worker.fetch(make("/v2/operator/auth/status","GET",undefined,{Cookie:cookie}),f.env)).json();
 assert.equal(session.authenticated,true);
 assert.equal(session.role,"owner");
 const create=await worker.fetch(make("/v2/operator/api/team/add","POST",{
  email:"ficticio@example.invalid",role:"reader",
 },{Cookie:cookie}),f.env);
 assert.equal(create.status,503);
 assert.match((await create.json()).message,/0007_operator_approvals/);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env)).status,200);
});

test("Revocar autorización inutiliza un código pendiente incluso si el rol se reactiva",async()=>{
 const f=fixture(),{cookie}=await enroll(f);
 const memberEmail="codigo-pendiente@example.invalid";
 const created=await worker.fetch(make("/v2/operator/api/team/add","POST",{
  email:memberEmail,role:"reader",
 },{Cookie:cookie}),f.env);
 assert.equal(created.status,201);
 const accountId=(await created.json()).account_id;
 const mail={code:null},now=Date.now()+61000;
 const send=await operatorStart(make("/v2/operator/auth/start","POST",{email:memberEmail}),
  f.env,async(_,init)=>{
   mail.code=/Tu código temporal es: (\d{6})/.exec(JSON.parse(init.body).text)?.[1];
   return {ok:true};
  },now);
 assert.equal(send.status,202);
 const challenge=(await send.json()).challenge_id;
 const disable=await worker.fetch(make("/v2/operator/api/team/change","POST",{
  account_id:accountId,role:"reader",status:"disabled",
 },{Cookie:cookie}),f.env);
 assert.equal(disable.status,200);
 const stored=f.sqlite.prepare("SELECT consumed_at FROM operator_login_challenges WHERE challenge_id=?").get(challenge);
 assert.ok(stored.consumed_at);
 const restore=await worker.fetch(make("/v2/operator/api/team/change","POST",{
  account_id:accountId,role:"reader",status:"active",
 },{Cookie:cookie}),f.env);
 assert.equal(restore.status,200);
 const rejected=await operatorVerify(make("/v2/operator/auth/verify","POST",{
  challenge_id:challenge,code:mail.code,
 }),f.env,now+250);
 assert.equal(rejected.status,401);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_sessions WHERE account_id=?").get(accountId).n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_emails WHERE email_normalized=?").get(memberEmail).n,0);
});


async function authorizedMember(f,ownerCookie,email,role){
 const created=await worker.fetch(make("/v2/operator/api/team/add","POST",{email,role},
  {Cookie:ownerCookie}),f.env);
 assert.equal(created.status,201);
 const id=(await created.json()).account_id;
 let code=null;
 const now=Date.now()+61000;
 const sent=await operatorStart(make("/v2/operator/auth/start","POST",{email}),
  f.env,async(_,opts)=>{
   code=/Tu código temporal es: (\d{6})/.exec(JSON.parse(opts.body).text)?.[1];
   return {ok:true};
  },now);
 assert.equal(sent.status,202);
 const token=(await sent.json()).challenge_id;
 const verified=await operatorVerify(make("/v2/operator/auth/verify","POST",{
  challenge_id:token,code,
 }),f.env,now+150);
 assert.equal(verified.status,200);
 return {id,cookie:verified.headers.get("Set-Cookie").split(";")[0]};
}
function secondCase(f){
 const id="22222222-2222-4222-8222-222222222222";
 f.sqlite.prepare([
  "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
  "VALUES (?,?,?,?,?)",
 ].join(" ")).run(id,"DAU-TEST-SECOND","p1","Otro asunto ficticio","staging_demo");
 return id;
}
test("Caso por caso: lector inicialmente ve cero asuntos, solo el que el owner le asigna",async()=>{
 const f=fixture(),{cookie:owner}=await enroll(f),second=secondCase(f);
 assert.equal(await caseAccessSchemaReady(f.env),true);
 const {id:reader,cookie}=await authorizedMember(f,owner,"lectura@example.invalid","reader");
 const q="/v2/operator/api/queue";
 const before=await (await worker.fetch(make(q,"GET",undefined,{Cookie:cookie}),f.env)).json();
 assert.equal(before.statistics.total,0);
 assert.equal(before.cases.length,0);
 const granted=await worker.fetch(make("/v2/operator/api/assignments/change","POST",{
  account_id:reader,request_id:"11111111-1111-4111-8111-111111111111",allow:true,
 },{Cookie:owner}),f.env);
 assert.equal(granted.status,200);
 const after=await (await worker.fetch(make(q,"GET",undefined,{Cookie:cookie}),f.env)).json();
 assert.equal(after.statistics.total,1);
 assert.equal(after.cases.length,1);
 assert.equal(after.cases[0].public_folio,"DAU-TEST-ADMIN");
 const history="/v2/operator/api/history/";
 assert.equal((await worker.fetch(make(history+"11111111-1111-4111-8111-111111111111","GET",undefined,{Cookie:cookie}),f.env)).status,200);
 assert.equal((await worker.fetch(make(history+second,"GET",undefined,{Cookie:cookie}),f.env)).status,403);
 const ownerQueue=await (await worker.fetch(make(q,"GET",undefined,{Cookie:owner}),f.env)).json();
 assert.equal(ownerQueue.statistics.total,2);
 const allocations=await (await worker.fetch(make("/v2/operator/api/assignments/list","GET",undefined,{Cookie:owner}),f.env)).json();
 assert.equal(allocations.assignments.length,1);
 assert.equal(allocations.assignments[0].account_id,reader);
 assert.equal((await worker.fetch(make("/v2/operator/api/assignments/list","GET",undefined,{Cookie:cookie}),f.env)).status,403);
 const revoked=await worker.fetch(make("/v2/operator/api/assignments/change","POST",{
  account_id:reader,request_id:"11111111-1111-4111-8111-111111111111",allow:false,
 },{Cookie:owner}),f.env);
 assert.equal(revoked.status,200);
 assert.equal((await (await worker.fetch(make(q,"GET",undefined,{Cookie:cookie}),f.env)).json()).statistics.total,0);
 assert.equal((await worker.fetch(make(history+"11111111-1111-4111-8111-111111111111","GET",undefined,{Cookie:cookie}),f.env)).status,403);
});

test("Gestor: acciones, seguimiento y citas SOLO sobre expediente asignado",async()=>{
 const f=fixture(),{cookie:owner}=await enroll(f),second=secondCase(f);
 const {id,cookie}=await authorizedMember(f,owner,"gestor-caso@example.invalid","manager");
 const caseA="11111111-1111-4111-8111-111111111111";
 const add=await worker.fetch(make("/v2/operator/api/assignments/change","POST",{
  account_id:id,request_id:caseA,allow:true,
 },{Cookie:owner}),f.env);
 assert.equal(add.status,200);
 const endpoint="/v2/operator/api/status";
 const denied=await worker.fetch(make(endpoint,"POST",{
  request_id:second,expected_status:"new",new_status:"contacted",
 },{Cookie:cookie,"Idempotency-Key":"not-my-case-0001"}),f.env);
 assert.equal(denied.status,403);
 const valid=await worker.fetch(make(endpoint,"POST",{
  request_id:caseA,expected_status:"new",new_status:"contacted",
 },{Cookie:cookie,"Idempotency-Key":"my-case-status-01"}),f.env);
 assert.equal(valid.status,200);
 const recorded=await worker.fetch(make("/v2/operator/api/record","POST",{
  request_id:caseA,expected_status:"contacted",action:"documents_requested",
 },{Cookie:cookie,"Idempotency-Key":"my-case-record-01"}),f.env);
 assert.equal(recorded.status,201);
 const notRecorded=await worker.fetch(make("/v2/operator/api/record","POST",{
  request_id:second,expected_status:"new",action:"documents_requested",
 },{Cookie:cookie,"Idempotency-Key":"unassigned-event01"}),f.env);
 assert.equal(notRecorded.status,403);
 const agenda=(await (await worker.fetch(make("/v2/operator/api/followups","GET",undefined,{Cookie:owner}),f.env)).json());
 const date=agenda.today;
 const task=await worker.fetch(make("/v2/operator/api/followups/create","POST",{
  request_id:caseA,action_code:"contact_again",due_date:date,
 },{Cookie:cookie,"Idempotency-Key":"manager-task-01"}),f.env);
 assert.equal(task.status,201);
 const taskId=(await task.json()).task_id;
 const taskB=await worker.fetch(make("/v2/operator/api/followups/create","POST",{
  request_id:second,action_code:"contact_again",due_date:date,
 },{Cookie:cookie,"Idempotency-Key":"manager-task-02"}),f.env);
 assert.equal(taskB.status,403);
 const completion=await worker.fetch(make("/v2/operator/api/followups/complete","POST",{
  task_id:taskId,confirm:"confirmar-pendiente",
 },{Cookie:cookie}),f.env);
 assert.equal(completion.status,200);
 assert.equal((await worker.fetch(make("/v2/operator/api/create","POST",{
  client_key:"demo-cliente1",case_type:"civil",
 },{Cookie:cookie,"Idempotency-Key":"manager-create-not-allowed"}),f.env)).status,403);
 assert.equal((await worker.fetch(make("/v2/operator/api/invite","POST",{
  request_id:caseA,confirm:"autorizar-envio-de-prueba",
 },{Cookie:cookie}),f.env)).status,403);
 const summary=f.sqlite.prepare(
  "SELECT COUNT(*) AS n FROM request_events WHERE request_id=?"
 ).get(second).n;
 assert.equal(summary,0);
});

test("Agenda de lector sólo expone tareas de asuntos expresamente asignados",async()=>{
 const f=fixture(),{cookie:owner}=await enroll(f),second=secondCase(f);
 const {id,cookie}=await authorizedMember(f,owner,"lector-agenda@example.invalid","reader");
 const today=(await (await worker.fetch(make("/v2/operator/api/followups","GET",undefined,{Cookie:owner}),f.env)).json()).today;
 f.sqlite.prepare("INSERT INTO followup_tasks(task_id,request_id,action_code,due_date) VALUES (?,?,?,?)")
  .run("followup-"+"a".repeat(64),"11111111-1111-4111-8111-111111111111","contact_again",today);
 f.sqlite.prepare("INSERT INTO followup_tasks(task_id,request_id,action_code,due_date) VALUES (?,?,?,?)")
  .run("followup-"+"b".repeat(64),second,"review_documents",today);
 await worker.fetch(make("/v2/operator/api/assignments/change","POST",{
  account_id:id,request_id:"11111111-1111-4111-8111-111111111111",allow:true,
 },{Cookie:owner}),f.env);
 const data=(await (await worker.fetch(make("/v2/operator/api/followups","GET",undefined,{Cookie:cookie}),f.env)).json());
 assert.equal(data.count,1);
 assert.equal(data.tasks[0].public_folio,"DAU-TEST-ADMIN");
 assert.equal(data.summary.soon,1);
 const ownerData=(await (await worker.fetch(make("/v2/operator/api/followups","GET",undefined,{Cookie:owner}),f.env)).json());
 assert.equal(ownerData.count,2);
});
