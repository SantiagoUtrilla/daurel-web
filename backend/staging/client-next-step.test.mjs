import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {newSessionToken,tokenHash} from "./auth-core.js";
import {roleAllows} from "./operator-auth.js";
import worker from "./worker.js";
import {ownerNextStepView,ownerNextStepSave,currentClientNextStep,PUBLIC_NEXT_STEPS} from "./client-next-step.js";
import {operatorPageResponse} from "./operator-page.js";

const BASE="https://staging.invalid",OWNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIRST="11111111-1111-4111-8111-111111111111",SECOND="22222222-2222-4222-8222-222222222222";
const PRIVATE="ANOTACIÓN PRIVADA: datos personales reservados";
function st(db,sql,args=[]){return {
 bind:(...v)=>st(db,sql,v),
 all:async()=>({results:db.prepare(sql).all(...args)}),
 first:async()=>db.prepare(sql).get(...args)||null,
 run:async()=>({meta:db.prepare(sql).run(...args)}),
};}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 }
 const env={DB:{prepare:sql=>st(sqlite,sql)},ENVIRONMENT:"staging",
  AUTH_OTP_HMAC_SECRET:"test-secret-long-enough-for-session-tests-123456",
  STAGING_CLIENT_EMAIL_PILOT_ENABLED:"true",
  STAGING_CLIENT_TEST_EMAILS:"sountibeats@gmail.com",
  TURNSTILE_SITE_KEY:"staging-site-test-key",
  TURNSTILE_SECRET_KEY:"staging-secret-test-key-long-enough",
  RESEND_API_KEY:"re_test-long-enough-secret",
  AUTH_EMAIL_FROM:"acceso@daurel.com.mx",
 };
 const cookies=[];
 for(const [id,email] of [[OWNER,"daurelcontact@gmail.com"],[OTHER,"sountibeats@gmail.com"]]){
  const token=newSessionToken();cookies.push("__Host-daurel_v2_pilot="+token);
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(id);
  sqlite.prepare([
   "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
   "VALUES (?,?,?,CURRENT_TIMESTAMP)",
  ].join(" ")).run(crypto.randomUUID(),id,email);
  sqlite.prepare([
   "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
   "VALUES (?,?,?,?)",
  ].join(" ")).run(crypto.randomUUID(),id,await tokenHash(token),new Date(Date.now()+3600000).toISOString());
 }
 for(const [id,party] of [[FIRST,"one"],[SECOND,"two"]]){
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").run(party);
  sqlite.prepare([
   "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
   "VALUES (?,?,?,'Solicitud ficticia: consulta laboral','staging_demo')",
  ].join(" ")).run(id,id===FIRST?"DAU-ONE":"DAU-TWO",party);
 }
 for(const [account,id] of [[OWNER,FIRST],[OTHER,SECOND]]){
  sqlite.prepare([
   "INSERT INTO account_request_access(account_id,request_id,permission,grant_basis)",
   "VALUES (?,?,'view','verified_authorization')",
  ].join(" ")).run(account,id);
 }
 sqlite.prepare([
  "INSERT INTO request_events(event_id,request_id,event_type,summary)",
  "VALUES ('private-event',?,'operator_whatsapp_attempt',?)",
 ].join(" ")).run(FIRST,PRIVATE);
 return {sqlite,env,owner:{account_id:OWNER,role:"owner"},
  manager:{account_id:OTHER,role:"manager"},reader:{account_id:OTHER,role:"reader"},
  ownerCookie:cookies[0],otherCookie:cookies[1]};
}
function save(id=FIRST,code="review_request",expected="new",key=crypto.randomUUID(),origin=BASE){
 return new Request(BASE+"/v2/operator/api/client-next-step",{
  method:"POST",headers:{Origin:origin,"Content-Type":"application/json","Idempotency-Key":key},
  body:JSON.stringify({request_id:id,action_code:code,expected_status:expected}),
 });
}
function view(id=FIRST){
 return new Request(BASE+"/v2/operator/api/client-next-step?request_id="+id);
}
function progress(id,cookie){
 return new Request(BASE+"/v2/client/api/progress?request_id="+id,{
  headers:cookie?{Cookie:cookie}:{},
 });
}
test("Propietario publica paso predefinido, el cliente lo ve y ningún otro cliente lo ve",async()=>{
 const f=await fixture();
 const before=await (await worker.fetch(progress(FIRST,f.ownerCookie),f.env)).json();
 assert.equal(before.has_published_next_action,false);
 assert.equal((await ownerNextStepSave(save(),f.env,f.owner)).status,201);
 const current=await (await ownerNextStepView(view(),f.env,f.owner)).json();
 assert.equal(current.current.code,"review_request");
 assert.equal(current.templates.review_request,PUBLIC_NEXT_STEPS.review_request);
 const after=await (await worker.fetch(progress(FIRST,f.ownerCookie),f.env)).json();
 assert.equal(after.has_published_next_action,true);
 assert.equal(after.next_step,PUBLIC_NEXT_STEPS.review_request);
 assert.ok(after.milestones.some(m=>m.label.includes("próximo paso")));
 assert.ok(!JSON.stringify(after).includes(PRIVATE));
 assert.ok(!JSON.stringify(after).includes("operator_whatsapp_attempt"));
 assert.equal((await worker.fetch(progress(FIRST,f.otherCookie),f.env)).status,404);
 assert.equal((await worker.fetch(progress(SECOND,f.ownerCookie),f.env)).status,404);
 const second=await (await worker.fetch(progress(SECOND,f.otherCookie),f.env)).json();
 assert.equal(second.has_published_next_action,false);
 assert.ok(!JSON.stringify(second).includes(PUBLIC_NEXT_STEPS.review_request));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_request_access").get().n,2);
});
test("Publicar, repetir, cambiar y retirar el mensaje deja trazabilidad y vuelve al texto general",async()=>{
 const f=await fixture(),key="unique-idempotency-key-1";
 const first=await ownerNextStepSave(save(FIRST,"review_request","new",key),f.env,f.owner);
 assert.equal(first.status,201);
 const identical=await (await ownerNextStepSave(save(FIRST,"review_request","new",key),f.env,f.owner)).json();
 assert.equal(identical.replayed,true);
 const reused=await ownerNextStepSave(save(FIRST,"coordinate_contact","new",key),f.env,f.owner);
 assert.equal(reused.status,409);
 const second=await ownerNextStepSave(save(FIRST,"coordinate_contact"),f.env,f.owner);
 assert.equal(second.status,201);
 let current=await currentClientNextStep(f.env.DB,FIRST);
 assert.equal(current.code,"coordinate_contact");
 const cleared=await ownerNextStepSave(save(FIRST,"clear"),f.env,f.owner);
 assert.equal(cleared.status,201);
 assert.equal(await currentClientNextStep(f.env.DB,FIRST),null);
 const after=await (await worker.fetch(progress(FIRST,f.ownerCookie),f.env)).json();
 assert.equal(after.has_published_next_action,false);
 assert.equal(after.next_step.startsWith("DAUREL revisará"),true);
 assert.equal(f.sqlite.prepare([
  "SELECT COUNT(*) AS n FROM request_events WHERE event_type IN",
  "('client_next_step_published','client_next_step_cleared')",
 ].join(" ")).get().n,3);
});
test("Solo propietario de staging puede publicar, nunca gestores ni lectores",async()=>{
 const f=await fixture();
 for(const actor of [f.manager,f.reader,null]){
  assert.equal((await ownerNextStepView(view(),f.env,actor)).status,403);
  assert.equal((await ownerNextStepSave(save(),f.env,actor)).status,403);
 }
 assert.equal(roleAllows("reader","/v2/operator/api/client-next-step","GET"),false);
 assert.equal(roleAllows("manager","/v2/operator/api/client-next-step","POST"),false);
 assert.equal(roleAllows("owner","/v2/operator/api/client-next-step","GET"),true);
 assert.equal(roleAllows("owner","/v2/operator/api/client-next-step","POST"),true);
 assert.equal((await ownerNextStepSave(save(),{...f.env,ENVIRONMENT:"production"},f.owner)).status,403);
 assert.equal((await ownerNextStepView(view(),{...f.env,ENVIRONMENT:"production"},f.owner)).status,403);
});
test("Rechaza texto libre, HTML, fechas no confirmadas, expedientes ajenos y stale status",async()=>{
 const f=await fixture();
 const bad=[
  {action_code:"<script>"},
  {action_code:"revisar expediente mañana"},
  {action_code:"confirmed_appointment"},
  {request_id:"invalid"},
  {expected_status:"closed"},
  {body:{request_id:FIRST,action_code:"review_request",expected_status:"new",note:"Datos confidenciales"}},
 ];
 for(const entry of bad){
  let payload=entry.body||{request_id:entry.request_id||FIRST,
   action_code:entry.action_code||"review_request",
   expected_status:entry.expected_status||"new"};
  const request=new Request(BASE+"/v2/operator/api/client-next-step",{
   method:"POST",headers:{Origin:BASE,"Content-Type":"application/json",
    "Idempotency-Key":crypto.randomUUID()},body:JSON.stringify(payload),
  });
  assert.ok([400,409].includes((await ownerNextStepSave(request,f.env,f.owner)).status),JSON.stringify(entry));
 }
 assert.equal((await ownerNextStepSave(save(FIRST,"review_request","new",crypto.randomUUID(),"https://evil.invalid"),f.env,f.owner)).status,403);
 assert.equal((await ownerNextStepSave(save("33333333-3333-4333-8333-333333333333"),f.env,f.owner)).status,404);
 f.sqlite.prepare("UPDATE service_requests SET status='closed' WHERE request_id=?").run(FIRST);
 assert.equal((await ownerNextStepSave(save(FIRST,"review_request","closed"),f.env,f.owner)).status,409);
 assert.equal((await ownerNextStepSave(save(FIRST,"clear","closed"),f.env,f.owner)).status,200);
});
test("El panel contiene editor plegable y publicación explícita separada de la agenda interna",async()=>{
 const html=await operatorPageResponse().text();
 for(const phrase of ["Información de próximo paso visible al cliente",
  "Publicar al cliente","Retirar mensaje",
  "/v2/operator/api/client-next-step",
  "No envía correo o WhatsApp ni publica tareas internas."]){
  assert.ok(html.includes(phrase),phrase);
 }
});
