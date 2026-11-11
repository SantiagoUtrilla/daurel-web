// Invitaciones de expediente SOLO staging. DB real NO usada; Resend simulado.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {newSessionToken,tokenHash} from "./auth-core.js";
import {issuePilotInvite,redeemPilotInvite,viewPilotInvitedMatters} from "./invitation-api.js";
import worker from "./worker.js";

const TECH="clave-tecnica-staging-sintetica-larga-1234567890";
const NOW=Date.parse("2026-11-09T22:00:00.000Z");
const ROOT="https://staging.invalid/v2/demo/invitations";
function prepared(sqlite,sql,bindings=[]){
 return {
  bind:(...a)=>prepared(sqlite,sql,a),
  run:async()=>({meta:sqlite.prepare(sql).run(...bindings)}),
  first:async()=>sqlite.prepare(sql).get(...bindings)||null,
  all:async()=>({results:sqlite.prepare(sql).all(...bindings)}),
 };
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const migration of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+migration,import.meta.url),"utf8"));
 }
 const DB={
  prepare:sql=>prepared(sqlite,sql),
  batch:async statements=>{
   const results=[];sqlite.exec("BEGIN");
   try{
    for(const stmt of statements)results.push(await stmt.run());
    sqlite.exec("COMMIT");return results;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  },
 };
 sqlite.prepare("INSERT INTO channel_accounts(channel_account_id,provider,provider_account_id) VALUES ('daurel-v2-demo','staging','fixture')").run();
 for(const [party,key] of [["p1","demo-cliente1"],["p2","demo-cliente2"]]){
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").run(party);
  sqlite.prepare("INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id) VALUES (?,?,?,?)")
   .run("id-"+party,party,"daurel-v2-demo",key);
 }
 for(const [id,folio,party,summary] of [
  ["r1","DAU-20261109-0001","p1","Solicitud ficticia: consulta laboral"],
  ["r2","DAU-20261109-0002","p1","Solicitud ficticia: asunto civil"],
  ["r3","DAU-20261109-0003","p2","Solicitud ficticia: registro de marca"],
 ]){
  sqlite.prepare([
   "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
   "VALUES (?,?,?,?,'staging_demo')",
  ].join(" ")).run(id,folio,party,summary);
 }
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES ('account1')").run();
 sqlite.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES ('email1','account1','daurelcontact@gmail.com',CURRENT_TIMESTAMP)",
 ].join(" ")).run();
 const session=newSessionToken();
 const hash=await tokenHash(session);
 sqlite.prepare([
  "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('s1','account1',?,'2099-12-01T00:00:00.000Z')",
 ].join(" ")).run(hash);
 return {sqlite,DB,env:{DB,ENVIRONMENT:"staging",STAGING_TEST_TOKEN:TECH,
   RESEND_API_KEY:"re_token_sintetico_de_prueba",AUTH_EMAIL_FROM:"acceso@daurel.com.mx"},
  cookie:"__Host-daurel_v2_pilot="+session};
}
function req(path,method="GET",value,opts={}){
 const headers={Authorization:"Bearer "+TECH};
 if(opts.cookie)headers.Cookie=opts.cookie;
 if(opts.origin)headers.Origin=opts.origin;
 if(value!==undefined)headers["Content-Type"]="application/json";
 return new Request(ROOT+path,{method,headers,
  body:value===undefined?undefined:JSON.stringify(value)});
}
function issueBody(type,client="demo-cliente1"){
 return {client_key:client,case_type:type,confirm:"emitir-invitacion-ficticia"};
}
async function providerCapture(){
 const sent=[];
 return {sent,send:async(url,init)=>{
  assert.equal(url,"https://api.resend.com/emails");
  assert.ok(init.headers["Idempotency-Key"].startsWith("daurel-v2-case-invite/"));
  const data=JSON.parse(init.body);
  assert.deepEqual(data.to,["daurelcontact@gmail.com"]);
  assert.equal(data.from,"DAUREL <acceso@daurel.com.mx>");
  const code=data.text.match(/Si necesitas introducirlo manualmente, tu código es: ([A-Za-z0-9_-]{43})/)?.[1];
  assert.match(code,/^[A-Za-z0-9_-]{43}$/);
  sent.push({code,data});
  return {ok:true};
 }};
}

test("Invitación específica: solo muestra el asunto aceptado, incluso si la cuenta tiene otros permisos",async()=>{
 const f=await fixture(),p=await providerCapture();
 const initial=await (await viewPilotInvitedMatters(req("/my-cases","GET",undefined,{cookie:f.cookie}),f.env,NOW)).json();
 assert.equal(initial.count,0);
 // Permiso anterior de alcance por cliente: no entra en el nuevo portal por expediente.
 f.sqlite.prepare([
  "INSERT INTO account_party_access(account_id,party_id,grant_basis)",
  "VALUES ('account1','p1','manual_review')",
 ].join(" ")).run();
 const issued=await issuePilotInvite(req("/issue","POST",issueBody("laboral")),f.env,p.send,NOW);
 assert.equal(issued.status,202);
 const receipt=await issued.json();
 assert.equal(receipt.public_folio,"DAU-20261109-0001");
 assert.equal(receipt.grants_real_access,false);
 assert.ok(!JSON.stringify(receipt).includes(p.sent[0].code));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_request_access").get().n,0);
 const red=await redeemPilotInvite(req("/redeem","POST",{code:p.sent[0].code},{cookie:f.cookie}),f.env,NOW+1000);
 assert.equal(red.status,200);
 const status=await red.json();
 assert.equal(status.redeemed,true);
 const view=await (await viewPilotInvitedMatters(req("/my-cases","GET",undefined,{cookie:f.cookie}),f.env,NOW+2000)).json();
 assert.equal(view.count,1);
 assert.deepEqual(view.matters.map(x=>x.public_folio),["DAU-20261109-0001"]);
 assert.ok(!JSON.stringify(view).includes("DAU-20261109-0002"));
 assert.ok(!JSON.stringify(view).includes("DAU-20261109-0003"));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM case_access_audit WHERE event_type='invitation_redeemed'").get().n,1);
});

test("Canje de un solo uso: repetirlo no reabre permiso revocado",async()=>{
 const f=await fixture(),p=await providerCapture();
 await issuePilotInvite(req("/issue","POST",issueBody("civil")),f.env,p.send,NOW);
 const code=p.sent[0].code;
 const first=await redeemPilotInvite(req("/redeem","POST",{code},{cookie:f.cookie}),f.env,NOW+500);
 assert.equal(first.status,200);
 f.sqlite.prepare("UPDATE account_request_access SET revoked_at=CURRENT_TIMESTAMP WHERE account_id='account1' AND request_id='r2'").run();
 const second=await redeemPilotInvite(req("/redeem","POST",{code},{cookie:f.cookie}),f.env,NOW+600);
 assert.equal(second.status,401);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM case_access_audit WHERE event_type='invitation_redeemed'").get().n,1);
 const view=await (await viewPilotInvitedMatters(req("/my-cases","GET",undefined,{cookie:f.cookie}),f.env,NOW+700)).json();
 assert.equal(view.count,0);
});

test("Caducidad, email verificado y restricciones de envío",async()=>{
 const f=await fixture(),p=await providerCapture();
 const missingSession=await redeemPilotInvite(req("/redeem","POST",{code:"A".repeat(43)}),f.env,NOW);
 assert.equal(missingSession.status,401);
 const noTech=await worker.fetch(new Request(ROOT+"/my-cases"),f.env);
 assert.equal(noTech.status,401);
 const invalid=await issuePilotInvite(req("/issue","POST",issueBody("laboral"),{origin:"https://evil.invalid"}),f.env,p.send,NOW);
 assert.equal(invalid.status,403);
 const sent=await issuePilotInvite(req("/issue","POST",issueBody("laboral")),f.env,p.send,NOW);
 assert.equal(sent.status,202);
 const repeat=await issuePilotInvite(req("/issue","POST",issueBody("laboral")),f.env,p.send,NOW+1000);
 assert.equal(repeat.status,429);
 assert.equal(p.sent.length,1);
 const expiry=await redeemPilotInvite(req("/redeem","POST",{code:p.sent[0].code},{cookie:f.cookie}),f.env,NOW+24*60*60*1000+1);
 assert.equal(expiry.status,401);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_request_access").get().n,0);
 const unknown=await issuePilotInvite(req("/issue","POST",issueBody("marcas","demo-cliente1")),f.env,p.send,NOW);
 assert.equal(unknown.status,404);
});

test("Múltiples invitaciones diferentes no fusionan cuentas ni expedientes",async()=>{
 const f=await fixture(),p=await providerCapture();
 await issuePilotInvite(req("/issue","POST",issueBody("laboral")),f.env,p.send,NOW);
 await issuePilotInvite(req("/issue","POST",issueBody("civil")),f.env,p.send,NOW);
 assert.equal(p.sent.length,2);
 await redeemPilotInvite(req("/redeem","POST",{code:p.sent[1].code},{cookie:f.cookie}),f.env,NOW+1000);
 let v=await (await viewPilotInvitedMatters(req("/my-cases","GET",undefined,{cookie:f.cookie}),f.env,NOW+2000)).json();
 assert.deepEqual(v.matters.map(x=>x.public_folio),["DAU-20261109-0002"]);
 await redeemPilotInvite(req("/redeem","POST",{code:p.sent[0].code},{cookie:f.cookie}),f.env,NOW+3000);
 v=await (await viewPilotInvitedMatters(req("/my-cases","GET",undefined,{cookie:f.cookie}),f.env,NOW+4000)).json();
 assert.equal(v.count,2);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_request_access").get().n,2);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,1);
});

test("Reenvío de invitación sin esperar 15 minutos; nueva clave revoca la anterior", async()=>{
 const f=await fixture(),p=await providerCapture();
 const a=await issuePilotInvite(req("/issue","POST",issueBody("laboral")),f.env,p.send,NOW);
 assert.equal(a.status,202);
 const first=p.sent[0].code;
 const blocked=await issuePilotInvite(req("/issue","POST",issueBody("laboral")),f.env,p.send,NOW+1000);
 assert.equal(blocked.status,429);
 const b=await issuePilotInvite(req("/issue","POST",issueBody("laboral")),f.env,p.send,NOW+31*1000);
 assert.equal(b.status,202);
 const second=p.sent[1].code;
 assert.notEqual(first,second);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM case_invitations").get().n,2);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM case_invitations WHERE revoked_at IS NOT NULL").get().n,1);
 const firstAttempt=await redeemPilotInvite(req("/redeem","POST",{code:first},{cookie:f.cookie}),f.env,NOW+31*1000+100);
 assert.equal(firstAttempt.status,401);
 const secondAttempt=await redeemPilotInvite(req("/redeem","POST",{code:second},{cookie:f.cookie}),f.env,NOW+31*1000+200);
 assert.equal(secondAttempt.status,200);
 const view=await (await viewPilotInvitedMatters(req("/my-cases","GET",undefined,{cookie:f.cookie}),f.env,NOW+31*1000+300)).json();
 assert.equal(view.count,1);
});
