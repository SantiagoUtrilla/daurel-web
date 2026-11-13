// DAUREL V2 — Seguimiento visible al cliente, solo datos ficticios y permisos activos.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "./worker.js";
import {newSessionToken,tokenHash} from "./auth-core.js";
import {clientCaseProgress} from "./client-progress-api.js";

const BASE="https://staging.invalid",OWNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIRST="11111111-1111-4111-8111-111111111111";
const SECOND="22222222-2222-4222-8222-222222222222";
const PRIVATE_TEXT="NO REVELAR INTERNO: contrato, teléfono privado y credenciales";
function stmt(db,sql,args=[]){return {
 bind:(...v)=>stmt(db,sql,v),
 all:async()=>({results:db.prepare(sql).all(...args)}),
 first:async()=>db.prepare(sql).get(...args)||null,
 run:async()=>({meta:db.prepare(sql).run(...args)}),
};}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
 }
 const env={DB:{prepare:sql=>stmt(sqlite,sql)},ENVIRONMENT:"staging",
  STAGING_CLIENT_EMAIL_PILOT_ENABLED:"true",
  STAGING_CLIENT_TEST_EMAILS:"sountibeats@gmail.com",
  TURNSTILE_SITE_KEY:"site-key-for-staging-test",
  TURNSTILE_SECRET_KEY:"secret-for-staging-test-only",
  AUTH_OTP_HMAC_SECRET:"test-hmac-key-of-sufficient-length-123456789",
  RESEND_API_KEY:"re_test-secret-for-unit-test",
  AUTH_EMAIL_FROM:"acceso@daurel.com.mx",
 };
 const tokens=[];
 for(const [id,email] of [[OWNER,"daurelcontact@gmail.com"],[OTHER,"sountibeats@gmail.com"]]){
  const token=newSessionToken();
  tokens.push("__Host-daurel_v2_pilot="+token);
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(id);
  sqlite.prepare([
   "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
   "VALUES (?,?,?,CURRENT_TIMESTAMP)",
  ].join(" ")).run(crypto.randomUUID(),id,email);
  sqlite.prepare([
   "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
   "VALUES (?,?,?,?)",
  ].join(" ")).run(crypto.randomUUID(),id,await tokenHash(token),new Date(Date.now()+86400000).toISOString());
 }
 for(const [id,name,party] of [[FIRST,"Solicitud ficticia: consulta laboral","p1"],
  [SECOND,"Solicitud ficticia: orientación contable","p2"]]){
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").run(party);
  sqlite.prepare([
   "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
   "VALUES (?,?,?,?,'staging_demo')",
  ].join(" ")).run(id,id===FIRST?"DAU-SAMPLE-01":"DAU-SAMPLE-02",party,name);
 }
 sqlite.prepare([
  "INSERT INTO account_request_access(account_id,request_id,permission,grant_basis)",
  "VALUES (?,?,'view','verified_authorization')",
 ].join(" ")).run(OWNER,FIRST);
 sqlite.prepare([
  "INSERT INTO account_request_access(account_id,request_id,permission,grant_basis)",
  "VALUES (?,?,'view','verified_authorization')",
 ].join(" ")).run(OTHER,SECOND);
 const add=(id,type,summary,date="2026-11-12 10:30:00")=>sqlite.prepare([
  "INSERT INTO request_events(event_id,request_id,event_type,summary,created_at)",
  "VALUES (?,?,?,?,?)",
 ].join(" ")).run(crypto.randomUUID(),id,type,summary,date);
 add(FIRST,"request_created",PRIVATE_TEXT);
 add(FIRST,"operator_whatsapp_attempt",PRIVATE_TEXT);
 add(FIRST,"operator_email_sent",PRIVATE_TEXT);
 add(FIRST,"followup_scheduled",PRIVATE_TEXT);
 add(FIRST,"status_changed","Estado ficticio: new → contacted");
 add(FIRST,"operator_reply_received",PRIVATE_TEXT);
 add(FIRST,"operator_documents_reviewed",PRIVATE_TEXT);
 add(FIRST,"status_changed","Estado ficticio: contacted → in_attention");
 add(FIRST,"status_changed","Estado ficticio: wrong → anything"+PRIVATE_TEXT);
 add(SECOND,"operator_documents_received",PRIVATE_TEXT);
 sqlite.prepare("UPDATE service_requests SET status='in_attention' WHERE request_id=?").run(FIRST);
 return {sqlite,env,owner:tokens[0],other:tokens[1]};
}
function req(id=FIRST,cookie,extra="",method="GET"){
 return new Request(BASE+"/v2/client/api/progress?request_id="+id+extra,{
  method,headers:cookie?{Cookie:cookie}:{},
 });
}
test("Expediente propio: avances permitidos, sin notas internas, intentos de contacto ni datos ajenos",async()=>{
 const f=await fixture();
 const response=await worker.fetch(req(FIRST,f.owner),f.env);
 assert.equal(response.status,200);
 assert.equal(response.headers.get("Cache-Control"),"no-store");
 const result=await response.json();
 assert.equal(result.success,true);
 assert.equal(result.status,"in_attention");
 assert.equal(result.status_label,"En atención");
 assert.equal(result.has_published_next_action,false);
 assert.ok(result.next_step.includes("Los avances se mostrarán"));
 assert.equal(result.milestones[0].label,"Solicitud recibida por DAUREL");
 assert.ok(result.milestones.some(x=>x.label.includes("respuesta del cliente")));
 assert.ok(result.milestones.some(x=>x.label.includes("revisión documental")));
 assert.ok(result.milestones.some(x=>x.label.includes("actualizó el estado")));
 assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
 assert.ok(!JSON.stringify(result).includes("whatsapp_attempt"));
 assert.ok(!JSON.stringify(result).includes("email_sent"));
 assert.ok(!JSON.stringify(result).includes("followup_scheduled"));
 assert.ok(!JSON.stringify(result).includes("operator_"));
 assert.ok(!JSON.stringify(result).includes("wrong"));
 assert.ok(!JSON.stringify(result).includes("DAU-SAMPLE-02"));
 const other=await (await worker.fetch(req(SECOND,f.other),f.env)).json();
 assert.equal(other.public_folio,"DAU-SAMPLE-02");
 assert.ok(!JSON.stringify(other).includes("DAU-SAMPLE-01"));
});
test("Acceso a historia: sin sesión 401, sin permiso 404 y después de revocación 404",async()=>{
 const f=await fixture();
 assert.equal((await worker.fetch(req(FIRST),f.env)).status,401);
 assert.equal((await worker.fetch(req(FIRST,f.other),f.env)).status,404);
 assert.equal((await worker.fetch(req(SECOND,f.owner),f.env)).status,404);
 f.sqlite.prepare([
  "UPDATE account_request_access SET revoked_at=CURRENT_TIMESTAMP",
  "WHERE account_id=? AND request_id=?",
 ].join(" ")).run(OWNER,FIRST);
 assert.equal((await worker.fetch(req(FIRST,f.owner),f.env)).status,404);
});
test("La ruta no acepta parámetros de más, IDs malformados, POST ni datos reales",async()=>{
 const f=await fixture();
 for(const id of ["r1","11111111","<script>","0".repeat(37)]){
  assert.equal((await worker.fetch(req(id,f.owner),f.env)).status,400,id);
 }
 assert.equal((await worker.fetch(req(FIRST,f.owner,"&secret=yes"),f.env)).status,400);
 assert.equal((await worker.fetch(req(FIRST,f.owner,"&request_id="+SECOND),f.env)).status,400);
 assert.equal((await worker.fetch(req(FIRST,f.owner,"","POST"),f.env)).status,405);
 assert.equal((await clientCaseProgress(req(FIRST,f.owner),{...f.env,ENVIRONMENT:"production"})).status,403);
});
test("La interfaz cliente tiene seguimiento desplegable y no carga notas privadas al listar",async()=>{
 const f=await fixture();
 const page=await (await worker.fetch(new Request(BASE+"/v2/client"),f.env)).text();
 assert.match(page,/Ver seguimiento/);
 assert.match(page,/Actualizar seguimiento/);
 assert.match(page,/api\/progress\?request_id=/);
 assert.match(page,/Qué sigue:/);
 assert.match(page,/details/);
 assert.ok(!page.includes(PRIVATE_TEXT));
});
