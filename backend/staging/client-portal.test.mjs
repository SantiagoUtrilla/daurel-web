// Pruebas de portal de cliente SIMULADO (nunca producción ni envío real).
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "./worker.js";
import {portalRequestLogin} from "./client-portal-api.js";
import {issuePilotInvite} from "./invitation-api.js";

const BASE="https://staging.invalid";
const HMAC="clave-hmac-para-tests-independiente-y-larga-1234567890";
const TECH="clave-tecnica-demo-extensa-larga-01234567890";
const NOW=Date.now();
function statement(db,sql,values=[]){
 return {
  bind:(...v)=>statement(db,sql,v),
  run:async()=>({meta:db.prepare(sql).run(...values)}),
  first:async()=>db.prepare(sql).get(...values)||null,
  all:async()=>({results:db.prepare(sql).all(...values)}),
 };
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 }
 sqlite.prepare(
  "INSERT INTO channel_accounts(channel_account_id,provider,provider_account_id) VALUES ('daurel-v2-demo','staging','p')"
 ).run();
 sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES ('p1','person')").run();
 sqlite.prepare(
  "INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id) VALUES ('i1','p1','daurel-v2-demo','demo-cliente1')"
 ).run();
 sqlite.prepare([
  "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
  "VALUES ('r1','DAU-TEST-1001','p1','Solicitud ficticia: consulta laboral','staging_demo')",
 ].join(" ")).run();
 sqlite.prepare([
  "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
  "VALUES ('r2','DAU-TEST-1002','p1','Solicitud ficticia: asunto civil','staging_demo')",
 ].join(" ")).run();
 const db={
  prepare:sql=>statement(sqlite,sql),
  batch:async stmts=>{
   sqlite.exec("BEGIN");
   try{
    const res=[];for(const s of stmts)res.push(await s.run());
    sqlite.exec("COMMIT");return res;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  },
 };
 const env={DB:db,ENVIRONMENT:"staging",STAGING_TEST_TOKEN:TECH,
  AUTH_OTP_HMAC_SECRET:HMAC,AUTH_EMAIL_FROM:"acceso@daurel.com.mx",
  RESEND_API_KEY:"re_solo_test_simulado_12345"};
 return {sqlite,env};
}
function req(path,method="GET",body,opts={}){
 const h={...(opts.cookie?{Cookie:opts.cookie}:{})};
 if(opts.origin)h.Origin=opts.origin;
 if(opts.tech)h.Authorization="Bearer "+TECH;
 if(body!==undefined)h["Content-Type"]="application/json";
 return new Request(BASE+path,{method,headers:h,
  body:body===undefined?undefined:JSON.stringify(body)});
}
test("Portal sin clave técnica: página pública staging pero expedientes protegidos",async()=>{
 const f=await fixture();
 const page=await worker.fetch(req("/v2/client"),f.env);
 assert.equal(page.status,200);
 const html=await page.text();
 assert.match(html,/Consulta tus asuntos/);
 assert.ok(!html.includes("STAGING_TEST_TOKEN"));
 const session=await worker.fetch(req("/v2/client/api/session"),f.env);
 assert.equal((await session.json()).authenticated,false);
 assert.equal((await worker.fetch(req("/v2/client/api/cases"),f.env)).status,401);
 assert.equal((await worker.fetch(req("/v2/client/api/accept","POST",
  {code:"a".repeat(43)},{origin:BASE}),f.env)).status,401);
 assert.equal((await worker.fetch(req("/v2/client/api/start","POST"),f.env)).status,403);
 assert.equal((await worker.fetch(req("/v2/client/api/start","POST",undefined,{origin:"https://evil.invalid"}),f.env)).status,403);
 const badMethod=await worker.fetch(req("/v2/client/api/session","POST"),f.env);
 assert.equal(badMethod.status,405);
});

test("Cliente: OTP sin clave técnica, acceso solo tras invitación y cierre de sesión",async()=>{
 const {sqlite,env}=await fixture(); let code="";
 const mail=async(_url,init)=>{
  const data=JSON.parse(init.body);
  assert.deepEqual(data.to,["daurelcontact@gmail.com"]);
  code=data.text.match(/Tu código temporal es: (\d{6})/)?.[1];
  assert.match(code,/^\d{6}$/);
  return {ok:true};
 };
 const login=await portalRequestLogin(req("/v2/client/api/start","POST",undefined,{origin:BASE}),
  env,mail,NOW);
 assert.equal(login.status,202);
 const challenge=(await login.json()).challenge_id;
 const verified=await worker.fetch(req("/v2/client/api/verify","POST",
  {challenge_id:challenge,code},{origin:BASE}),env);
 assert.equal(verified.status,200);
 const cookie=verified.headers.get("set-cookie").split(";")[0];
 assert.match(cookie,/^__Host-daurel_v2_pilot=/);
 const session=await (await worker.fetch(req("/v2/client/api/session","GET",undefined,{cookie}),env)).json();
 assert.equal(session.authenticated,true);
 const empty=await (await worker.fetch(req("/v2/client/api/cases","GET",undefined,{cookie}),env)).json();
 assert.equal(empty.count,0);
 let invitationCode="";
 const inviteMail=async(_url,init)=>{
  const data=JSON.parse(init.body);
  invitationCode=data.text.match(/Si necesitas introducirlo manualmente, tu código es: ([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(data.text.includes(BASE.replace("staging.invalid","daurel-backend-staging.lmsantiagoutrilla.workers.dev") .replace("https://daurel-backend-staging.lmsantiagoutrilla.workers.dev","https://daurel-backend-staging.lmsantiagoutrilla.workers.dev") + "/v2/client#invite=") ||
   data.text.includes("/v2/client#invite="));
  assert.match(invitationCode,/^[A-Za-z0-9_-]{43}$/);
  return {ok:true};
 };
 const invited=await issuePilotInvite(req("/v2/demo/invitations/issue","POST",
  {client_key:"demo-cliente1",case_type:"laboral",confirm:"emitir-invitacion-ficticia"},
  {origin:BASE,tech:true}),env,inviteMail,NOW+1000);
 assert.equal(invited.status,202);
 const accepted=await worker.fetch(req("/v2/client/api/accept","POST",
  {code:invitationCode},{origin:BASE,cookie}),env);
 assert.equal(accepted.status,200);
 const one=await (await worker.fetch(req("/v2/client/api/cases","GET",undefined,{cookie}),env)).json();
 assert.equal(one.count,1);
 assert.equal(one.matters[0].public_folio,"DAU-TEST-1001");
 assert.ok(!JSON.stringify(one).includes("DAU-TEST-1002"));
 assert.equal((await worker.fetch(req("/v2/client/api/accept","POST",
  {code:invitationCode},{origin:BASE,cookie}),env)).status,401);
 const out=await worker.fetch(req("/v2/client/api/logout","POST",undefined,{origin:BASE,cookie}),env);
 assert.equal(out.status,200);
 assert.equal((await (await worker.fetch(req("/v2/client/api/session","GET",undefined,{cookie}),env)).json()).authenticated,false);
 assert.equal((await worker.fetch(req("/v2/client/api/cases","GET",undefined,{cookie}),env)).status,401);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM account_request_access WHERE revoked_at IS NULL").get().n,1);
});

test("Cliente simulado: tope diario de seis envíos y destinatario único",async()=>{
 const {env}=await fixture();
 let sent=0;
 const mail=async(_url,init)=>{
  sent++;
  assert.deepEqual(JSON.parse(init.body).to,["daurelcontact@gmail.com"]);
  return {ok:true};
 };
 for(let i=0;i<6;i++){
  const res=await portalRequestLogin(req("/v2/client/api/start","POST",undefined,{origin:BASE}),env,mail,NOW+i*61*1000);
  assert.equal(res.status,202);
 }
 const rate=await portalRequestLogin(req("/v2/client/api/start","POST",undefined,{origin:BASE}),env,mail,NOW+7*61*1000);
 assert.equal(rate.status,429);
 assert.equal(sent,6);
 const wrongEmailRequest=await portalRequestLogin(req("/v2/client/api/start","POST",
  {email:"extrano@ejemplo.invalid"},{origin:BASE}),env,mail,NOW+8*61*1000);
 assert.equal(wrongEmailRequest.status,403);
});

test("Cliente simulado: rehúsa operar con ENVIRONMENT diferente a staging",async()=>{
 const {env}=await fixture();
 const p=await worker.fetch(req("/v2/client"),{...env,ENVIRONMENT:"production"});
 assert.equal(p.status,403);
});


test("Portal cliente actualizado: estado humano, botón refrescar y sincronía al volver al celular",async()=>{
 const {env}=await fixture();
 const response=await worker.fetch(req("/v2/client"),env);
 assert.equal(response.status,200);
 const page=await response.text();
 assert.match(page,/id="refresh-cases"/);
 assert.match(page,/visibilitychange/);
 assert.match(page,/Contacto confirmado/);
 assert.match(page,/En atención/);
 assert.match(page,/Recibido/);
 assert.ok(!page.includes("STAGING_TEST_TOKEN"));
});
