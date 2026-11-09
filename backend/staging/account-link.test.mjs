// Validar aislamiento por cliente ficticio y autorización explícita. No usa correo real.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {newSessionToken,tokenHash} from "./auth-core.js";
import worker from "./worker.js";

const BASE="https://staging.invalid";
const SECRET="clave-tecnica-sintetica-super-larga-para-staging-123";
function prepare(sqlite,sql,args=[]){
 return {
  bind:(...values)=>prepare(sqlite,sql,values),
  run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  first:async()=>sqlite.prepare(sql).get(...args)||null,
 };
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_v2_core.sql","0002_optional_accounts.sql"])
  sqlite.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
 const env={ENVIRONMENT:"staging",STAGING_TEST_TOKEN:SECRET,
  DB:{prepare:sql=>prepare(sqlite,sql)}};
 sqlite.prepare("INSERT INTO channel_accounts(channel_account_id,provider,provider_account_id) VALUES ('daurel-v2-demo','staging','fixture')").run();
 const client=(key,id)=>{
  sqlite.prepare("INSERT INTO parties(party_id,kind,display_name) VALUES (?,'person',?)").run(id,key);
  sqlite.prepare("INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id) VALUES (?,?,?,?)")
    .run("identity-"+id,id,"daurel-v2-demo",key);
 };
 client("demo-cliente1","p1");client("demo-cliente2","p2");
 sqlite.prepare("INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel) VALUES (?,?,?,?,'staging_demo')")
  .run("r1","DAU-TEST-001","p1","Solicitud ficticia: consulta laboral");
 sqlite.prepare("INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel) VALUES (?,?,?,?,'staging_demo')")
  .run("r2","DAU-TEST-002","p1","Solicitud ficticia: asunto civil");
 sqlite.prepare("INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel) VALUES (?,?,?,?,'staging_demo')")
  .run("r3","DAU-TEST-003","p2","Solicitud ficticia: registro de marca");
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES ('account-a')").run();
 sqlite.prepare("INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at) VALUES ('email-a','account-a','daurelcontact@gmail.com',CURRENT_TIMESTAMP)").run();
 const token=newSessionToken(),hash=await tokenHash(token);
 sqlite.prepare("INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at) VALUES ('session-a','account-a',?,'2099-01-01T00:00:00.000Z')").run(hash);
 return {sqlite,env,cookie:"__Host-daurel_v2_pilot="+token};
}
function req(path,method,cookie,body,auth=true,origin=BASE){
 const headers={};
 if(auth)headers.Authorization="Bearer "+SECRET;
 if(cookie)headers.Cookie=cookie;
 if(method==="POST")headers.Origin=origin;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request(BASE+path,{
  method,headers,body:body===undefined?undefined:JSON.stringify(body),
 });
}
const checked=clientKey=>({client_key:clientKey,confirm:"confirmar-vinculo-ficticio"});

test("Cuenta con OTP verificado empieza sin expedientes; vinculaciones explícitas aisladas",async()=>{
 const {sqlite,env,cookie}=await fixture();
 const path="/v2/demo/account/data";
 const noToken=await worker.fetch(req(path,"GET",cookie,undefined,false),env);
 assert.equal(noToken.status,401);
 const noSession=await worker.fetch(req(path,"GET",null),env);
 assert.equal(noSession.status,401);
 const empty=await (await worker.fetch(req(path,"GET",cookie),env)).json();
 assert.equal(empty.count,0);
 assert.deepEqual(empty.matters,[]);
 const link=await worker.fetch(req("/v2/demo/account/link","POST",cookie,checked("demo-cliente1")),env);
 assert.equal(link.status,200);
 assert.equal((await link.json()).linked,true);
 const allowed=await (await worker.fetch(req(path,"GET",cookie),env)).json();
 assert.equal(allowed.count,2);
 assert.deepEqual(new Set(allowed.matters.map(m=>m.client_key)),new Set(["demo-cliente1"]));
 assert.ok(!JSON.stringify(allowed).includes("DAU-TEST-003"));
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM account_party_access WHERE revoked_at IS NULL").get().n,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM account_access_audit WHERE event_type='party_granted'").get().n,1);
});

test("Vincular, revocar y reactivar no filtra asuntos de otros clientes",async()=>{
 const {sqlite,env,cookie}=await fixture();
 const post=(path,body)=>worker.fetch(req(path,"POST",cookie,body),env);
 assert.equal((await post("/v2/demo/account/link",checked("demo-cliente1"))).status,200);
 assert.equal((await post("/v2/demo/account/link",checked("demo-cliente2"))).status,200);
 let found=await (await worker.fetch(req("/v2/demo/account/data","GET",cookie),env)).json();
 assert.equal(found.count,3);
 const unlinked=await post("/v2/demo/account/unlink",checked("demo-cliente2"));
 assert.equal(unlinked.status,200);
 found=await (await worker.fetch(req("/v2/demo/account/data","GET",cookie),env)).json();
 assert.equal(found.count,2);
 assert.ok(found.matters.every(x=>x.client_key==="demo-cliente1"));
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM account_access_audit WHERE event_type='party_revoked'").get().n,1);
 assert.equal((await post("/v2/demo/account/link",checked("demo-cliente2"))).status,200);
 found=await (await worker.fetch(req("/v2/demo/account/data","GET",cookie),env)).json();
 assert.equal(found.count,3);
});

test("Rechaza sin sesión, sin confirmación, cliente inexistente y origen ajeno",async()=>{
 const {sqlite,env,cookie}=await fixture();
 const target="/v2/demo/account/link";
 const one=await worker.fetch(req(target,"POST",null,checked("demo-cliente1")),env);
 assert.equal(one.status,401);
 const two=await worker.fetch(req(target,"POST",cookie,{client_key:"demo-cliente1",confirm:"no"}),env);
 assert.equal(two.status,400);
 const three=await worker.fetch(req(target,"POST",cookie,checked("demo-inexistente")),env);
 assert.equal(three.status,404);
 const four=await worker.fetch(req(target,"POST",cookie,checked("demo-cliente1"),true,"https://evil.invalid"),env);
 assert.equal(four.status,403);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM account_party_access").get().n,0);
 sqlite.prepare("UPDATE account_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_id='session-a'").run();
 const five=await worker.fetch(req(target,"POST",cookie,checked("demo-cliente1")),env);
 assert.equal(five.status,401);
 assert.equal((await worker.fetch(req("/v2/demo/account/data","GET",cookie),env)).status,401);
});
