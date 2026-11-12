// Revocación de cliente: pruebas E2E en SQLite de memoria, sin datos ni correos reales.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "./worker.js";
import {newSessionToken,tokenHash} from "./auth-core.js";

const BASE="https://staging.invalid";
const CASE_LAB="11111111-1111-4111-8111-111111111111";
const CASE_CIV="22222222-2222-4222-8222-222222222222";
const CASE_REAL="33333333-3333-4333-8333-333333333333";
const OWNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONFIRM="revocar-acceso-cliente-ficticio";
const INVITE_CODE="A".repeat(43);
const expiry=new Date(Date.now()+3600000).toISOString();

function request(path,method="GET",body,opts={}){
 const headers={...(opts.cookie?{Cookie:opts.cookie}:{})};
 if(method==="POST")headers.Origin=opts.origin??BASE;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request(BASE+path,{method,headers,
  body:body===undefined?undefined:JSON.stringify(body)});
}
function st(db,query,args=[]){
 return {
  bind:(...values)=>st(db,query,values),
  run:async()=>({meta:db.prepare(query).run(...args)}),
  first:async()=>db.prepare(query).get(...args)||null,
  all:async()=>({results:db.prepare(query).all(...args)}),
 };
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of ["0001_v2_core.sql","0002_optional_accounts.sql",
   "0003_case_invitations.sql","0006_operator_identity.sql",
   "0007_operator_approvals.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 }
 const env={
  DB:{prepare:query=>st(sqlite,query),batch:async statements=>{
   sqlite.exec("BEGIN");
   try{
    const result=[];for(const q of statements)result.push(await q.run());
    sqlite.exec("COMMIT");return result;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }},
  ENVIRONMENT:"staging",STAGING_TEST_TOKEN:"test-staging-technical-token-over-32-characters",
 };
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(OWNER);
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(MEMBER);
 sqlite.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES ('owner-mail',?,'daurelcontact@gmail.com',CURRENT_TIMESTAMP)",
 ].join(" ")).run(OWNER);
 sqlite.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES ('member-mail',?,'colaborador@example.invalid',CURRENT_TIMESTAMP)",
 ].join(" ")).run(MEMBER);
 sqlite.prepare("INSERT INTO operator_memberships(account_id,role) VALUES (?,'owner')").run(OWNER);
 sqlite.prepare("INSERT INTO operator_memberships(account_id,role) VALUES (?,'reader')").run(MEMBER);
 sqlite.prepare([
  "INSERT INTO operator_approved_emails(email_normalized,account_id,approved_by_account_id)",
  "VALUES ('colaborador@example.invalid',?,?)",
 ].join(" ")).run(MEMBER,OWNER);
 const ownerToken=newSessionToken(),clientToken=newSessionToken(),memberToken=newSessionToken();
 sqlite.prepare([
  "INSERT INTO operator_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('owner-session',?,?,?)",
 ].join(" ")).run(OWNER,await tokenHash(ownerToken),expiry);
 sqlite.prepare([
  "INSERT INTO operator_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('member-session',?,?,?)",
 ].join(" ")).run(MEMBER,await tokenHash(memberToken),expiry);
 sqlite.prepare([
  "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('client-session',?,?,?)",
 ].join(" ")).run(OWNER,await tokenHash(clientToken),expiry);
 sqlite.prepare([
  "INSERT INTO channel_accounts(channel_account_id,provider,provider_account_id)",
  "VALUES ('daurel-v2-demo','staging','p')",
 ].join(" ")).run();
 sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES ('p1','person')").run();
 for(const [id,folio,channel] of [[CASE_LAB,"DAU-TEST-LAB","staging_demo"],
  [CASE_CIV,"DAU-TEST-CIV","staging_demo"],[CASE_REAL,"DAU-REAL-NEVER","legacy_v1_web"]]){
  sqlite.prepare([
   "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
   "VALUES (?,?,'p1','Solicitud ficticia de ensayo',?)",
  ].join(" ")).run(id,folio,channel);
 }
 for(const id of [CASE_LAB,CASE_CIV]){
  sqlite.prepare([
   "INSERT INTO account_request_access(account_id,request_id,permission,grant_basis)",
   "VALUES (?,?,'view','case_invitation')",
  ].join(" ")).run(OWNER,id);
 }
 sqlite.prepare([
  "INSERT INTO case_invitations(invitation_id,request_id,intended_email,code_sha256,issue_bucket,expires_at,sent_at)",
  "VALUES ('pending-lab',?,'daurelcontact@gmail.com',?,'test',?,CURRENT_TIMESTAMP)",
 ].join(" ")).run(CASE_LAB,await tokenHash(INVITE_CODE),expiry);
 return {
  sqlite,env,ownerCookie:"__Host-daurel_v2_operator="+ownerToken,
  memberCookie:"__Host-daurel_v2_operator="+memberToken,
  clientCookie:"__Host-daurel_v2_pilot="+clientToken,
 };
}
const REVOKE="/v2/operator/api/client-access/revoke";
function body(request_id=CASE_LAB){return {request_id,confirm:CONFIRM}}

test("Solo el propietario revoca acceso de cliente en un expediente, sin cerrar sesión ni afectar otros",async()=>{
 const f=await fixture();
 const before=await (await worker.fetch(request("/v2/client/api/cases","GET",undefined,
  {cookie:f.clientCookie}),f.env)).json();
 assert.equal(before.count,2);
 const r=await worker.fetch(request(REVOKE,"POST",body(),{cookie:f.ownerCookie}),f.env);
 assert.equal(r.status,200);
 const response=await r.json();
 assert.equal(response.revoked_accounts,1);
 assert.equal(response.revoked_invitations,1);
 assert.equal(response.synthetic_only,true);
 const account=(await (await worker.fetch(request("/v2/client/api/session","GET",undefined,
  {cookie:f.clientCookie}),f.env)).json());
 assert.equal(account.authenticated,true);
 const cases=await (await worker.fetch(request("/v2/client/api/cases","GET",undefined,
  {cookie:f.clientCookie}),f.env)).json();
 assert.equal(cases.count,1);
 assert.deepEqual(cases.matters.map(c=>c.public_folio),["DAU-TEST-CIV"]);
 assert.ok(f.sqlite.prepare("SELECT revoked_at FROM account_request_access WHERE request_id=?").get(CASE_LAB).revoked_at);
 assert.ok(f.sqlite.prepare("SELECT revoked_at FROM case_invitations WHERE request_id=?").get(CASE_LAB).revoked_at);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM case_access_audit WHERE request_id=? AND event_type='access_revoked'").get(CASE_LAB).n,1);
 const redeemed=await worker.fetch(request("/v2/client/api/accept","POST",
  {code:INVITE_CODE},{cookie:f.clientCookie}),f.env);
 assert.equal(redeemed.status,401);
 const repeat=await worker.fetch(request(REVOKE,"POST",body(),{cookie:f.ownerCookie}),f.env);
 assert.equal(repeat.status,200);
 assert.equal((await repeat.json()).replayed,true);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM case_access_audit WHERE request_id=? AND event_type='access_revoked'").get(CASE_LAB).n,1);
});

test("Revocación de cliente bloquea lectores, gestores, ausentes y orígenes externos",async()=>{
 const f=await fixture();
 const unknown=await worker.fetch(request(REVOKE,"POST",body()),f.env);
 assert.equal(unknown.status,401);
 const reader=await worker.fetch(request(REVOKE,"POST",body(),{cookie:f.memberCookie}),f.env);
 assert.equal(reader.status,403);
 f.sqlite.prepare("UPDATE operator_memberships SET role='manager' WHERE account_id=?").run(MEMBER);
 const manager=await worker.fetch(request(REVOKE,"POST",body(),{cookie:f.memberCookie}),f.env);
 assert.equal(manager.status,403);
 const cross=await worker.fetch(request(REVOKE,"POST",body(),{cookie:f.ownerCookie,origin:"https://evil.invalid"}),f.env);
 assert.equal(cross.status,403);
 const unconfirmed=await worker.fetch(request(REVOKE,"POST",
  {request_id:CASE_LAB,confirm:"equivocado"},{cookie:f.ownerCookie}),f.env);
 assert.equal(unconfirmed.status,400);
 const real=await worker.fetch(request(REVOKE,"POST",body(CASE_REAL),{cookie:f.ownerCookie}),f.env);
 assert.equal(real.status,404);
 const notStaging=await worker.fetch(request(REVOKE,"POST",body(),{cookie:f.ownerCookie}),
  {...f.env,ENVIRONMENT:"production"});
 assert.equal(notStaging.status,403);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_request_access WHERE revoked_at IS NULL").get().n,2);
});

test("Panel de propietario ofrece la revocación de cliente distinta de colaboradores",async()=>{
 const f=await fixture();
 const page=await (await worker.fetch(request("/v2/operator"),f.env)).text();
 assert.match(page,/Retirar acceso del cliente/);
 assert.match(page,/client-access\/revoke/);
 assert.match(page,/Acceso de colaboradores a este expediente/);
});
