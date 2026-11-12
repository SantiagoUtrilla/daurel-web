// Solicitudes sin cuenta con Turnstile obligatorio y reclamación por correo OTP.
// SQLite de memoria, nunca producción ni tráfico a Cloudflare o Resend.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "./worker.js";
import {submitGuestRequest} from "./guest-intake.js";
import {newSessionToken,tokenHash} from "./auth-core.js";

const BASE="https://staging.invalid",PATH="/v2/guest/api/create";
const SECRET="turnstile-secret-staging-mock-not-real-123456";
const ACTION="guest_staging",ACCOUNT="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function stmt(sqlite,sql,args=[]){
 return {bind:(...v)=>stmt(sqlite,sql,v),
  run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
  first:async()=>sqlite.prepare(sql).get(...args)||null,
  all:async()=>({results:sqlite.prepare(sql).all(...args)})};
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
 }
 const DB={prepare:sql=>stmt(sqlite,sql),batch:async statements=>{
  sqlite.exec("BEGIN");
  try{const list=[];for(const q of statements)list.push(await q.run());
   sqlite.exec("COMMIT");return list;
  }catch(error){sqlite.exec("ROLLBACK");throw error}
 }};
 const env={DB,ENVIRONMENT:"staging",STAGING_GUEST_INTAKE_ENABLED:"true",
  TURNSTILE_SECRET_KEY:SECRET,TURNSTILE_SITE_KEY:"0x4AAAAAAA_TEST_SITE_KEY",
  AUTH_OTP_HMAC_SECRET:"otp-test-key-never-for-production-1234567890"};
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(ACCOUNT);
 sqlite.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES ('test-email',?,'daurelcontact@gmail.com',CURRENT_TIMESTAMP)",
 ].join(" ")).run(ACCOUNT);
 const token=newSessionToken();
 sqlite.prepare([
  "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at)",
  "VALUES ('session',?,?,?)",
 ].join(" ")).run(ACCOUNT,await tokenHash(token),new Date(Date.now()+3600000).toISOString());
 return {sqlite,env,cookie:"__Host-daurel_v2_pilot="+token};
}
function request(path=PATH,method="POST",body={case_type:"contaduria",turnstile_token:"turnstile-token-for-test"},opts={}){
 const headers={Origin:opts.origin??BASE,"CF-Connecting-IP":opts.ip??"203.0.113.12",
  "Idempotency-Key":opts.key??"11111111-1111-4111-8111-"+String(opts.n??1).padStart(12,"0")};
 if(opts.cookie)headers.Cookie=opts.cookie;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
function challenge({success=true,hostname="staging.invalid",action=ACTION}={}){
 let calls=0;
 return {get calls(){return calls},transport:async(url,opts)=>{
  calls++;
  assert.equal(url,"https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(opts.method,"POST");
  const payload=new URLSearchParams(opts.body);
  assert.equal(payload.get("secret"),SECRET);
  assert.equal(payload.get("remoteip"),"203.0.113.12");
  return {ok:true,json:async()=>({success,hostname,action})};
 }};
}
const rows=(sqlite,table)=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;

test("Inactivo por defecto: no permite solicitudes y jamás publica la secret en HTML",async()=>{
 const {sqlite,env}=await fixture();
 const missing={...env,STAGING_GUEST_INTAKE_ENABLED:undefined};
 const page=await (await worker.fetch(new Request(BASE+"/v2/guest"),missing)).text();
 assert.match(page,/todavía no está activado/);
 assert.ok(!page.includes(SECRET));
 assert.ok(!page.includes('<div class="cf-turnstile"'));
 const response=await worker.fetch(request(),missing);
 assert.equal(response.status,503);
 assert.equal(rows(sqlite,"service_requests"),0);
});

test("Guest sin sesión crea asunto contable; con OTP y código puede reclamarlo una vez",async()=>{
 const {sqlite,env,cookie}=await fixture();
 const page=await (await worker.fetch(new Request(BASE+"/v2/guest"),env)).text();
 assert.match(page,/Crear solicitud sin cuenta/);
 assert.match(page,/data-action="guest_staging"/);
 assert.ok(page.includes(env.TURNSTILE_SITE_KEY));
 assert.ok(!page.includes(SECRET));
 const mock=challenge();
 const response=await submitGuestRequest(request(),env,mock.transport);
 assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
 assert.equal(mock.calls,1);
 const created=await response.json();
 assert.equal(created.synthetic_only,true);
 assert.match(created.public_folio,/^DAU-\d{8}-\d{4}$/);
 assert.match(created.claim_code,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(rows(sqlite,"service_requests"),1);
 assert.equal(rows(sqlite,"account_request_access"),0);
 // Correo verificado sin prueba de posesión del token no muestra el expediente.
 const before=await (await worker.fetch(new Request(BASE+"/v2/client/api/cases",{
  headers:{Cookie:cookie}}),env)).json();
 assert.equal(before.count,0);
 const accepted=await worker.fetch(request("/v2/client/api/accept","POST",
  {code:created.claim_code},{cookie}),env);
 assert.equal(accepted.status,200);
 const after=await (await worker.fetch(new Request(BASE+"/v2/client/api/cases",{
  headers:{Cookie:cookie}}),env)).json();
 assert.equal(after.count,1);
 assert.equal(after.matters[0].public_folio,created.public_folio);
 const used=await worker.fetch(request("/v2/client/api/accept","POST",
  {code:created.claim_code},{cookie}),env);
 assert.equal(used.status,401);
});

test("Turnstile exige hostname y acción; rechaza peticiones con origen ajeno",async()=>{
 const {env,sqlite}=await fixture();
 for(const detail of [
  {success:false},{hostname:"evil.invalid"},{action:"other"},
 ]){
  const response=await submitGuestRequest(request(),env,challenge(detail).transport);
  assert.equal(response.status,403);
 }
 assert.equal((await submitGuestRequest(request(PATH,"POST",undefined,{origin:"https://evil.invalid"}),
  env,challenge().transport)).status,403);
 const malformed=request(PATH,"POST",{case_type:"laboral",turnstile_token:"goodtoken",owner_email:"attacker@example.invalid"});
 assert.equal((await submitGuestRequest(malformed,env,challenge().transport)).status,400);
 const noIp=new Request(BASE+PATH,{method:"POST",
  headers:{Origin:BASE,"Content-Type":"application/json","Idempotency-Key":"11111111-1111-4111-8111-111111111111"},
  body:JSON.stringify({case_type:"civil",turnstile_token:"tokenok"})});
 assert.equal((await submitGuestRequest(noIp,env,challenge().transport)).status,403);
 assert.equal(rows(sqlite,"service_requests"),0);
});

test("Reenvío idempotente no crea expediente ni expone la clave privada dos veces",async()=>{
 const {env,sqlite}=await fixture();
 const mock=challenge();
 const one=await (await submitGuestRequest(request(),env,mock.transport)).json();
 const repeat=await submitGuestRequest(request(),env,mock.transport);
 assert.equal(repeat.status,200);
 const repeated=await repeat.json();
 assert.equal(repeated.replayed,true);
 assert.equal(repeated.public_folio,one.public_folio);
 assert.equal(repeated.claim_code,undefined);
 assert.equal(mock.calls,1);
 const changed=await submitGuestRequest(request(PATH,"POST",
  {case_type:"civil",turnstile_token:"turnstile-token-for-test"}),env,mock.transport);
 assert.equal(changed.status,409);
 assert.equal(rows(sqlite,"service_requests"),1);
});

test("Un invitado anónimo tiene límite diario de tres solicitudes en la misma IP",async()=>{
 const {env,sqlite}=await fixture(),mock=challenge();
 for(let n=11;n<=13;n++){
  const res=await submitGuestRequest(request(PATH,"POST",undefined,{n}),env,mock.transport);
  assert.equal(res.status,201);
 }
 const fourth=await submitGuestRequest(request(PATH,"POST",undefined,{n:14}),env,mock.transport);
 assert.equal(fourth.status,429);
 assert.equal(rows(sqlite,"service_requests"),3);
});
