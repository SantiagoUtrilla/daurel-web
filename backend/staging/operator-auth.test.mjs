// Identidad de operador V2: SQLite en memoria + correo simulado; sin envíos reales.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
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
function fixture(operatorSchema=true){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const m of [
  "0001_v2_core.sql","0002_optional_accounts.sql",
  "0003_case_invitations.sql","0004_followup_tasks.sql",
  ...(operatorSchema?["0006_operator_identity.sql"]:[]),
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

test("Roles: lector solo ve; revocación surte efecto inmediatamente",async()=>{
 const f=fixture(),{cookie}=await enroll(f);
 f.sqlite.prepare("UPDATE operator_memberships SET role='reader'").run();
 assert.equal(roleAllows("reader","/v2/operator/api/queue","GET"),true);
 assert.equal(roleAllows("reader","/v2/operator/api/create","POST"),false);
 assert.equal((await worker.fetch(make("/v2/operator/api/queue","GET",undefined,{Cookie:cookie}),f.env)).status,200);
 assert.equal((await worker.fetch(make("/v2/operator/api/create","POST",
  {client_key:"demo-cliente1",case_type:"civil"},
  {Cookie:cookie,"Idempotency-Key":"reader-not-allowed"}),f.env)).status,403);
 assert.equal((await worker.fetch(make("/v2/operator/api/telegram/status","GET",undefined,{Cookie:cookie}),f.env)).status,403);
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
