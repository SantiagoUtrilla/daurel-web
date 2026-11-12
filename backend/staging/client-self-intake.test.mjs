// Integración autosolicitud de CLIENTE autenticado, solo laboratorio SQLite memoria.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "./worker.js";
import {tokenHash,newSessionToken} from "./auth-core.js";

const BASE="https://staging.invalid",EMAIL="daurelcontact@gmail.com";
const CASE_ID="11111111-1111-4111-8111-111111111111";
function query(sqlite,sql,vals=[]){
 return {bind:(...next)=>query(sqlite,sql,next),
  first:async()=>sqlite.prepare(sql).get(...vals)||null,
  all:async()=>({results:sqlite.prepare(sql).all(...vals)}),
  run:async()=>({meta:sqlite.prepare(sql).run(...vals)})};
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 }
 const DB={prepare:sql=>query(sqlite,sql),batch:async statements=>{
  sqlite.exec("BEGIN");
  try{const out=[];for(const st of statements)out.push(await st.run());
   sqlite.exec("COMMIT");return out;
  }catch(e){sqlite.exec("ROLLBACK");throw e}
 }};
 const account="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(account);
 sqlite.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES ('owner-email',?,?,CURRENT_TIMESTAMP)",
 ].join(" ")).run(account,EMAIL);
 const token=newSessionToken(),expires=new Date(Date.now()+3600000).toISOString();
 sqlite.prepare([
  "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('client-session',?,?,?)",
 ].join(" ")).run(account,await tokenHash(token),expires);
 // Un expediente preexistente, con el mismo correo en contacto,
 // NO debe vincularse por coincidencia de email.
 sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES ('legacy-p','person')").run();
 sqlite.prepare([
  "INSERT INTO party_contacts(contact_id,party_id,contact_type,contact_value,normalized_value)",
  "VALUES ('email-legacy','legacy-p','email',?,?)",
 ].join(" ")).run(EMAIL,EMAIL);
 sqlite.prepare([
  "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
  "VALUES (?,'DAU-OLD-1001','legacy-p','Asunto previo no autorizado','staging_demo')",
 ].join(" ")).run(CASE_ID);
 return {sqlite,env:{DB,ENVIRONMENT:"staging"},cookie:"__Host-daurel_v2_pilot="+token};
}
function req(path,method="GET",body,opts={}){
 const headers={};
 if(opts.cookie)headers.Cookie=opts.cookie;
 if(opts.origin)headers.Origin=opts.origin;
 if(opts.key)headers["Idempotency-Key"]=opts.key;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request(BASE+path,{method,headers,
  body:body===undefined?undefined:JSON.stringify(body)});
}
const PATH="/v2/client/api/create";
function key(n){return "12345678-1234-4234-8234-"+String(n).padStart(12,"0")}
const post=(f,n,case_type="contaduria")=>worker.fetch(req(PATH,"POST",{case_type},
 {origin:BASE,cookie:f.cookie,key:key(n)}),f.env);

test("Cliente verificado puede crear solicitud contable ficticia y obtiene acceso automático solo a ella",async()=>{
 const f=await fixture();
 const empty=await (await worker.fetch(req("/v2/client/api/cases","GET",undefined,
  {cookie:f.cookie}),f.env)).json();
 assert.equal(empty.count,0);
 const created=await post(f,1);
 assert.equal(created.status,201);
 const result=await created.json();
 assert.equal(result.access_active,true);
 assert.equal(result.synthetic_only,true);
 assert.match(result.public_folio,/^DAU-\d{8}-\d{4}$/);
 const cases=await (await worker.fetch(req("/v2/client/api/cases","GET",undefined,
  {cookie:f.cookie}),f.env)).json();
 assert.equal(cases.count,1);
 assert.equal(cases.matters[0].summary,"Solicitud ficticia: orientación contable");
 assert.equal(cases.matters[0].public_folio,result.public_folio);
 assert.ok(!JSON.stringify(cases).includes("DAU-OLD-1001"));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM account_request_access WHERE revoked_at IS NULL").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE event_type='client_access_auto_granted'").get().n,1);
 const repeat=await post(f,1);
 assert.equal(repeat.status,200);
 assert.equal((await repeat.json()).replayed,true);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM service_requests WHERE intake_channel='staging_demo'").get().n,2);
 const conflict=await post(f,1,"civil");
 assert.equal(conflict.status,409);
});

test("Revocación se respeta incluso si cliente reenvía solicitud con misma clave",async()=>{
 const f=await fixture();
 const created=await post(f,2,"laboral");
 assert.equal(created.status,201);
 const folio=(await created.json()).public_folio;
 f.sqlite.prepare([
  "UPDATE account_request_access SET revoked_at=CURRENT_TIMESTAMP",
  "WHERE request_id=(SELECT request_id FROM service_requests WHERE public_folio=?)",
 ].join(" ")).run(folio);
 const repeat=await post(f,2,"laboral");
 assert.equal(repeat.status,200);
 const data=await repeat.json();
 assert.equal(data.access_active,false);
 assert.equal(data.replayed,true);
 const cases=await (await worker.fetch(req("/v2/client/api/cases","GET",undefined,
  {cookie:f.cookie}),f.env)).json();
 assert.equal(cases.count,0);
});

test("Sin sesión, origen ajeno o parámetros adicionales nunca crea expediente",async()=>{
 const f=await fixture();
 assert.equal((await worker.fetch(req(PATH,"POST",{case_type:"civil"},
  {origin:BASE,key:key(3)}),f.env)).status,401);
 assert.equal((await worker.fetch(req(PATH,"POST",{case_type:"civil"},
  {origin:"https://evil.invalid",cookie:f.cookie,key:key(3)}),f.env)).status,403);
 assert.equal((await worker.fetch(req(PATH,"POST",{case_type:"civil",client_key:"demo-client"},
  {origin:BASE,cookie:f.cookie,key:key(3)}),f.env)).status,400);
 assert.equal((await worker.fetch(req(PATH,"POST",{case_type:"otro"},
  {origin:BASE,cookie:f.cookie,key:key(3)}),f.env)).status,400);
 assert.equal((await worker.fetch(req(PATH,"POST",{case_type:"civil"},
  {origin:BASE,cookie:f.cookie}),f.env)).status,400);
 assert.equal((await worker.fetch(req(PATH,"POST",{case_type:"civil"},
  {origin:BASE,cookie:f.cookie,key:key(3)}),{...f.env,ENVIRONMENT:"production"})).status,403);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM service_requests").get().n,1);
});

test("Tope por sesión: tres solicitudes ficticias diarias, no cuatro",async()=>{
 const f=await fixture();
 for(let i=10;i<13;i++) assert.equal((await post(f,i)).status,201);
 const extra=await post(f,13);
 assert.equal(extra.status,429);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM service_requests").get().n,4);
});

test("Portal incluye entrada autónoma y no expone acceso a expedientes por solo correo",async()=>{
 const f=await fixture();
 const page=await (await worker.fetch(req("/v2/client"),f.env)).text();
 assert.match(page,/id="create-request"/);
 assert.match(page,/id="new-service"/);
 assert.match(page,/v2\/client\/api\/create/);
 assert.match(page,/sin autorización manual/);
 assert.ok(!page.includes("STAGING_TEST_TOKEN"));
});
