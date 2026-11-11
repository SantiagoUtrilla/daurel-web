// Panel operador: staging + registros ficticios, email simulado.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {operatorQueue,operatorUpdateStatus,operatorSendInvitation} from "./operator-api.js";
import {newSessionToken,tokenHash} from "./auth-core.js";
import worker from "./worker.js";

const BASE="https://staging.invalid";
const TECH="clave-tecnica-operador-larga-1234567890";
const NOW=Date.now();

function prep(sqlite,sql,args=[]){
 return {
  bind:(...v)=>prep(sqlite,sql,v),
  run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  first:async()=>sqlite.prepare(sql).get(...args)||null,
 };
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
 }
 const db={prepare:sql=>prep(sqlite,sql),batch:async stmts=>{
  sqlite.exec("BEGIN");try{const result=[];for(const x of stmts)result.push(await x.run());
   sqlite.exec("COMMIT");return result;}catch(e){sqlite.exec("ROLLBACK");throw e}
 }};
 sqlite.prepare("INSERT INTO channel_accounts(channel_account_id,provider,provider_account_id) VALUES ('daurel-v2-demo','staging','test')").run();
 const id1="11111111-1111-4111-8111-111111111111",id2="22222222-2222-4222-8222-222222222222",id3="33333333-3333-4333-8333-333333333333";
 for(const [party,key] of [["p1","demo-cliente1"],["p2","demo-cliente2"]]){
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").run(party);
  sqlite.prepare("INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id) VALUES (?,?,?,?)")
   .run("i-"+party,party,"daurel-v2-demo",key);
 }
 for(const [id,folio,party,summary] of [
  [id1,"DAU-TEST-0001","p1","Solicitud ficticia: consulta laboral"],
  [id2,"DAU-TEST-0002","p1","Solicitud ficticia: asunto civil"],
  [id3,"DAU-TEST-0003","p2","Solicitud ficticia: registro de marca"],
 ]){
  sqlite.prepare([
   "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
   "VALUES (?,?,?,?,'staging_demo')",
  ].join(" ")).run(id,folio,party,summary);
 }
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES ('test-account')").run();
 sqlite.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES ('test-email','test-account','daurelcontact@gmail.com',CURRENT_TIMESTAMP)",
 ].join(" ")).run();
 const token=newSessionToken();
 sqlite.prepare([
  "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('s1','test-account',?,'2099-01-01T00:00:00.000Z')",
 ].join(" ")).run(await tokenHash(token));
 return {
  sqlite,env:{DB:db,ENVIRONMENT:"staging",STAGING_TEST_TOKEN:TECH,
   RESEND_API_KEY:"re_proveedor_simulado_123456",
   AUTH_EMAIL_FROM:"acceso@daurel.com.mx"},
  ids:[id1,id2,id3],cookie:"__Host-daurel_v2_pilot="+token,
 };
}
function req(path,method="GET",body,opts={}){
 const headers={};
 if(opts.tech!==false)headers.Authorization="Bearer "+(opts.badToken?"incorrecta".repeat(5):TECH);
 if(opts.cookie)headers.Cookie=opts.cookie;
 if(method==="POST")headers.Origin=opts.origin||BASE;
 if(opts.idem)headers["Idempotency-Key"]=opts.idem;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request(BASE+path,{
  method,headers,body:body===undefined?undefined:JSON.stringify(body),
 });
}
const change=(id,expected,next)=>({request_id:id,expected_status:expected,new_status:next});
const invite=id=>({request_id:id,confirm:"autorizar-envio-de-prueba"});

test("Panel: métricas y aislamiento, rutas protegidas ante accesos de cliente",async()=>{
 const f=await fixture();
 const publicPage=await worker.fetch(req("/v2/operator","GET",undefined,{tech:false}),f.env);
 assert.equal(publicPage.status,200);
 const html=await publicPage.text();
 assert.ok(html.includes("Centro de control interno"));
 assert.ok(!html.includes(TECH));
 const unauthorized=await worker.fetch(req("/v2/operator/api/queue","GET",undefined,{tech:false,cookie:f.cookie}),f.env);
 assert.equal(unauthorized.status,401);
 const wrong=await worker.fetch(req("/v2/operator/api/queue","GET",undefined,{badToken:true}),f.env);
 assert.equal(wrong.status,401);
 const data=await worker.fetch(req("/v2/operator/api/queue"),f.env);
 assert.equal(data.status,200);
 const body=await data.json();
 assert.equal(body.statistics.total,3);
 assert.equal(body.statistics.clients,2);
 assert.equal(body.statistics.new,3);
 assert.equal(body.cases.length,3);
 assert.ok(body.cases.every(x=>x.client_key.startsWith("demo-")));
 const nonStaging=await worker.fetch(req("/v2/operator/api/queue"),{...f.env,ENVIRONMENT:"production"});
 assert.equal(nonStaging.status,403);
});

test("Cambios de estado: idempotencia, historial, aislamiento de otros casos y transiciones",async()=>{
 const f=await fixture(),id=f.ids[0];
 const path="/v2/operator/api/status";
 const command=change(id,"new","contacted");
 const first=await worker.fetch(req(path,"POST",command,{idem:"status-00001"}),f.env);
 assert.equal(first.status,200);
 assert.equal((await first.json()).replayed,false);
 const current=f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(id);
 assert.equal(current.status,"contacted");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE request_id=? AND event_type='status_changed'").get(id).n,1);
 assert.equal((await worker.fetch(req(path,"POST",command,{idem:"status-00001"}),f.env)).status,200);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE request_id=? AND event_type='status_changed'").get(id).n,1);
 assert.equal((await worker.fetch(req(path,"POST",change(id,"new","cancelled"),{idem:"status-00001"}),f.env)).status,409);
 assert.equal((await worker.fetch(req(path,"POST",change(id,"new","contacted"),{idem:"status-00002"}),f.env)).status,409);
 assert.equal((await worker.fetch(req(path,"POST",change(id,"contacted","new"),{idem:"status-00003"}),f.env)).status,400);
 assert.equal((await worker.fetch(req(path,"POST",change(f.ids[1],"new","closed"),{idem:"status-00004"}),f.env)).status,400);
 const second=await worker.fetch(req(path,"POST",change(id,"contacted","in_attention"),{idem:"status-00005"}),f.env);
 assert.equal(second.status,200);
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(f.ids[1]).status,"new");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE request_id=? AND event_type='status_changed'").get(id).n,2);
 const data=await (await operatorQueue(f.env)).json();
 assert.equal(data.statistics.in_attention,1);
 assert.equal(data.statistics.new,2);
});

test("Estado y envíos: rechazo de parámetros incorrectos y origen externo",async()=>{
 const f=await fixture();
 const id=f.ids[0];
 assert.equal((await operatorUpdateStatus(req("/v2/operator/api/status","POST",change(id,"new","contacted"),{origin:"https://evil.invalid",idem:"status-00001"}),f.env)).status,403);
 assert.equal((await operatorUpdateStatus(req("/v2/operator/api/status","POST",change(id,"new","contacted"),{tech:false}),f.env)).status,400);
 assert.equal((await operatorSendInvitation(req("/v2/operator/api/invite","POST",invite(id),{origin:"https://evil.invalid"}),f.env,async()=>({ok:true}),NOW)).status,403);
 assert.equal((await operatorSendInvitation(req("/v2/operator/api/invite","POST",{
   request_id:id,confirm:"cualquier-cosa",
 }),f.env,async()=>({ok:true}),NOW)).status,400);
 assert.equal((await operatorSendInvitation(req("/v2/operator/api/invite","POST",invite("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),f.env,async()=>({ok:true}),NOW)).status,404);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM case_invitations").get().n,0);
});

test("Invitación de operador selecciona UUID exacto, deja aparte otros asuntos y usa enlace directo",async()=>{
 const f=await fixture();
 let invitationLink=null;
 const provider=async(url,init)=>{
  assert.equal(url,"https://api.resend.com/emails");
  const data=JSON.parse(init.body);
  assert.deepEqual(data.to,["daurelcontact@gmail.com"]);
  invitationLink=data.text.match(/https:\/\/[^\s]+#invite=([A-Za-z0-9_-]{43})/)?.[1];
  assert.match(invitationLink,/^[A-Za-z0-9_-]{43}$/);
  return {ok:true};
 };
 const selected=f.ids[1];
 const issued=await operatorSendInvitation(req("/v2/operator/api/invite","POST",invite(selected)),f.env,provider,NOW);
 assert.equal(issued.status,202);
 assert.equal((await issued.json()).public_folio,"DAU-TEST-0002");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM case_invitations WHERE request_id=?").get(selected).n,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_request_access").get().n,0);
 assert.equal((await operatorSendInvitation(req("/v2/operator/api/invite","POST",invite(selected)),f.env,provider,NOW+1000)).status,429);
 const accepted=await worker.fetch(req("/v2/client/api/accept","POST",{code:invitationLink},{tech:false,cookie:f.cookie}),f.env);
 assert.equal(accepted.status,200);
 const view=await (await worker.fetch(req("/v2/client/api/cases","GET",undefined,{tech:false,cookie:f.cookie}),f.env)).json();
 assert.equal(view.count,1);
 assert.equal(view.matters[0].public_folio,"DAU-TEST-0002");
 assert.ok(!JSON.stringify(view).includes("DAU-TEST-0001"));
 assert.ok(!JSON.stringify(view).includes("DAU-TEST-0003"));
 const same=await worker.fetch(req("/v2/client/api/accept","POST",{code:invitationLink},{tech:false,cookie:f.cookie}),f.env);
 assert.equal(same.status,401);
});
