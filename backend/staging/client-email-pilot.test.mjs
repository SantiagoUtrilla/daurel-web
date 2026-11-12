// Correo individual: pruebas de aislamiento y login con OTP simulado sin correos reales.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "./worker.js";
import {startClientEmailPilot,verifyClientEmailPilot} from "./client-email-pilot.js";
import {tokenHash,newSessionToken} from "./auth-core.js";

const BASE="https://staging.invalid",TEST="segunda.persona@example.test";
const EMAIL_OWNER="daurelcontact@gmail.com";
const ENV_SECRET="hmac-clave-ficticia-de-cuentas-de-prueba-321654987456";
const fixedToken="turnstile-token-valid-for-test-only";
function statement(sqlite,sql,args=[]){return {
 bind:(...v)=>statement(sqlite,sql,v),
 first:async()=>sqlite.prepare(sql).get(...args)||null,
 all:async()=>({results:sqlite.prepare(sql).all(...args)}),
 run:async()=>({meta:sqlite.prepare(sql).run(...args)})
}}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"])
  sqlite.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
 const DB={prepare:sql=>statement(sqlite,sql),
  batch:async statements=>{
   sqlite.exec("BEGIN");
   try{const result=[];for(const q of statements)result.push(await q.run());
    sqlite.exec("COMMIT");return result;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }};
 const env={DB,ENVIRONMENT:"staging",AUTH_OTP_HMAC_SECRET:ENV_SECRET,
  RESEND_API_KEY:"re_test-no-real-no-delivery",AUTH_EMAIL_FROM:"acceso@daurel.com.mx",
  STAGING_CLIENT_EMAIL_PILOT_ENABLED:"true",
  STAGING_CLIENT_TEST_EMAILS:TEST,
  TURNSTILE_SITE_KEY:"0x000000000000TESTSITE",
  TURNSTILE_SECRET_KEY:"turnstile-test-secret-never-real-123456"};
 const ownerId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(ownerId);
 sqlite.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES ('owner',?,?,CURRENT_TIMESTAMP)",
 ].join(" ")).run(ownerId,EMAIL_OWNER);
 const ownerToken=newSessionToken();
 sqlite.prepare([
  "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('owner-session',?,?,?)",
 ].join(" ")).run(ownerId,await tokenHash(ownerToken),new Date(Date.now()+3600000).toISOString());
 sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES ('p1','person')").run();
 sqlite.prepare([
  "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
  "VALUES ('11111111-1111-4111-8111-111111111111','DAU-OWN-0001','p1','Expediente ajeno','staging_demo')",
 ].join(" ")).run();
 sqlite.prepare([
  "INSERT INTO account_request_access(account_id,request_id,permission,grant_basis)",
  "VALUES (?,'11111111-1111-4111-8111-111111111111','view','verified_authorization')",
 ].join(" ")).run(ownerId);
 return {sqlite,env,ownerCookie:"__Host-daurel_v2_pilot="+ownerToken};
}
function post(path,body,opts={}){
 const headers={Origin:opts.origin??BASE,"Content-Type":"application/json",
  "CF-Connecting-IP":opts.ip??"203.0.113.25"};
 if(opts.cookie)headers.Cookie=opts.cookie;
 return new Request(BASE+path,{method:"POST",headers,body:JSON.stringify(body)});
}
const requestBody=email=>({email,turnstile_token:fixedToken});
function provider({hostname="staging.invalid",action="client_email_staging",success=true}={}){
 let otp=null,sentTo=null;
 const transport=async(url,init)=>{
  if(url.includes("siteverify")){
   assert.equal(new URLSearchParams(init.body).get("remoteip"),"203.0.113.25");
   return {ok:true,json:async()=>({success,hostname,action})};
  }
  assert.equal(url,"https://api.resend.com/emails");
  const message=JSON.parse(init.body);
  sentTo=message.to[0];
  otp=/Tu código temporal es: (\d{6})/.exec(message.text)?.[1];
  return {ok:true};
 };
 return {transport,get otp(){return otp},get sentTo(){return sentTo}};
}
async function start(f,p,email=TEST){
 return startClientEmailPilot(post("/v2/client/api/email/start",requestBody(email)),
  f.env,p.transport);
}
async function verify(f,data){
 return verifyClientEmailPilot(post("/v2/client/api/email/verify",data),f.env);
}
async function list(env,cookie){
 return worker.fetch(new Request(BASE+"/v2/client/api/cases",{headers:{Cookie:cookie}}),env);
}
test("Piloto por correo queda desactivado sin flag y lista; no revela direcciones de prueba",async()=>{
 const f=await fixture(),off={...f.env,STAGING_CLIENT_EMAIL_PILOT_ENABLED:"false"};
 assert.equal((await worker.fetch(new Request(BASE+"/v2/client/email-test"),off)).status,404);
 const response=await startClientEmailPilot(post("/v2/client/api/email/start",requestBody(TEST)),off,
  async()=>{throw Error("no debe salir");});
 assert.equal(response.status,503);
 const page=await (await worker.fetch(new Request(BASE+"/v2/client/email-test"),f.env)).text();
 assert.ok(page.includes("Correo de prueba autorizado"));
 assert.ok(page.includes("client_email_staging"));
 assert.ok(!page.includes(TEST));
 assert.ok(!page.includes(ENV_SECRET));
 const main=await (await worker.fetch(new Request(BASE+"/v2/client"),f.env)).text();
 assert.ok(!main.includes(TEST));
});
test("Dos correos de prueba: OTP independiente y cada cuenta ve solo sus expedientes",async()=>{
 const f=await fixture(),p=provider();
 const startResponse=await start(f,p);
 assert.equal(startResponse.status,202);
 assert.equal(p.sentTo,TEST);
 const challenge=(await startResponse.json()).challenge_id;
 const unknown=await start(f,p,"desconocido@example.test");
 assert.equal(unknown.status,400);
 const wrong=await verify(f,{challenge_id:challenge,code:"123456"===p.otp?"654321":"123456"});
 assert.equal(wrong.status,401);
 const verified=await verify(f,{challenge_id:challenge,code:p.otp});
 assert.equal(verified.status,200);
 const cookie=verified.headers.get("Set-Cookie").split(";")[0];
 assert.match(cookie,/^__Host-daurel_v2_pilot=/);
 const session=await (await worker.fetch(new Request(BASE+"/v2/client/api/session",{headers:{Cookie:cookie}}),f.env)).json();
 assert.equal(session.recipient,TEST);
 assert.equal(session.authenticated,true);
 const none=await (await list(f.env,cookie)).json();
 assert.equal(none.count,0);
 const owner=await (await list(f.env,f.ownerCookie)).json();
 assert.equal(owner.count,1);
 assert.equal(owner.matters[0].public_folio,"DAU-OWN-0001");
 const result=await worker.fetch(post("/v2/client/api/create",{case_type:"contaduria"},
  {cookie}),f.env); // Falta idempotency key: se prueba rechazo seguro.
 assert.equal(result.status,400);
 assert.equal((await verify(f,{challenge_id:challenge,code:p.otp})).status,401);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_emails").get().n,2);
});
test("Nuevo cliente verificado registra expediente ficticio sin verlo otro correo",async()=>{
 const f=await fixture(),p=provider();
 const sent=await start(f,p);
 const challenge=(await sent.json()).challenge_id;
 const login=await verify(f,{challenge_id:challenge,code:p.otp});
 assert.equal(login.status,200);
 const cookie=login.headers.get("Set-Cookie").split(";")[0];
 const req=post("/v2/client/api/create",{case_type:"laboral"},{cookie});
 req.headers.set("Idempotency-Key","11111111-1111-4111-8111-111111111113");
 const create=await worker.fetch(req,f.env);
 assert.equal(create.status,201);
 const folio=(await create.json()).public_folio;
 const owner=await (await list(f.env,f.ownerCookie)).json();
 assert.equal(owner.count,1);
 assert.equal(owner.matters[0].public_folio,"DAU-OWN-0001");
 const client=await (await list(f.env,cookie)).json();
 assert.equal(client.count,1);
 assert.equal(client.matters[0].public_folio,folio);
 assert.equal((await list(f.env,"")).status,401);
});
test("Turnstile y origen: bloquean inicios falsos; cuotas por destinatario",async()=>{
 const f=await fixture();
 for(const detail of [
  {success:false},{hostname:"evil.invalid"},{action:"otro"},
 ]){
  const x=await start(f,provider(detail));
  assert.equal(x.status,403);
 }
 const cross=await startClientEmailPilot(post("/v2/client/api/email/start",requestBody(TEST),
  {origin:"https://evil.invalid"}),f.env,async()=>{throw Error("No salir")});
 assert.equal(cross.status,403);
 for(let i=0;i<3;i++){
  const p=provider(),res=await start(f,p);
  assert.equal(res.status,202);
 }
 assert.equal((await start(f,provider())).status,429);
});
