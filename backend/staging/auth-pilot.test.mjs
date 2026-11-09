// Piloto OTP DAUREL, SQLite en memoria, Resend simulado: no hay envíos reales.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  startPilotLogin, verifyPilotLogin, getPilotSession, logoutPilotSession,
} from "./auth-pilot-api.js";
import worker from "./worker.js";

const TECH="clave-tecnica-larga-de-pruebas-sinteticas-1234567890";
const HMAC="otra-clave-de-firma-otp-independiente-muy-larga-2026";
const NOW=Date.parse("2026-11-09T20:00:00.000Z");
const BASE="https://staging.invalid/v2/demo/auth";

function fixture(schema=true){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 sqlite.exec(readFileSync(new URL("../migrations/0001_v2_core.sql",import.meta.url),"utf8"));
 if(schema)sqlite.exec(readFileSync(new URL("../migrations/0002_optional_accounts.sql",import.meta.url),"utf8"));
 function prepared(sql,args=[]){
  return {
   run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
   first:async()=>sqlite.prepare(sql).get(...args)||null,
   all:async()=>({results:sqlite.prepare(sql).all(...args)}),
   bind:(...values)=>prepared(sql,values),
  };
 }
 const DB={
  prepare:(sql)=>prepared(sql),
  batch:async(list)=>{
   sqlite.exec("BEGIN");
   try {
    const results=[];
    for(const statement of list){results.push(await statement.run());}
    sqlite.exec("COMMIT");return results;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 const env={
  DB,ENVIRONMENT:"staging",STAGING_TEST_TOKEN:TECH,
  AUTH_OTP_HMAC_SECRET:HMAC,
  RESEND_API_KEY:"re_esto-es-falso-solo-pruebas",
  AUTH_EMAIL_FROM:"acceso@daurel.com.mx",
 };
 return {sqlite,DB,env};
}
function post(url,body,extraHeaders={}){
 const headers={Authorization:"Bearer "+TECH,...extraHeaders};
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request(url,{method:"POST",headers,body:body===undefined?undefined:JSON.stringify(body)});
}
function get(url,cookie){
 const headers={Authorization:"Bearer "+TECH};
 if(cookie)headers.Cookie=cookie;
 return new Request(url,{headers});
}

test("OTP piloto: envío real simulado, sesión HttpOnly, sin expedientes y revocación",async()=>{
 const {sqlite,env}=fixture();
 let code=null,recipient=null;
 const mockProvider=async(url,init)=>{
  assert.equal(url,"https://api.resend.com/emails");
  const sent=JSON.parse(init.body);
  recipient=sent.to[0];
  code=/Tu código temporal es: (\d{6})/.exec(sent.text)?.[1];
  assert.match(init.headers.Authorization,/^Bearer re_/);
  return {ok:true};
 };
 const start=await startPilotLogin(post(BASE+"/start"),env,mockProvider,NOW);
 assert.equal(start.status,202);
 const result=await start.json();
 assert.equal(result.recipient,"daurelcontact@gmail.com");
 assert.equal(recipient,result.recipient);
 assert.match(code,/^\d{6}$/);
 assert.ok(!JSON.stringify(result).includes(code));
 assert.match(result.challenge_id,/^[0-9a-f-]{36}$/);
 const challenge=sqlite.prepare(
  "SELECT otp_hmac,attempts FROM login_challenges WHERE challenge_id=?"
 ).get(result.challenge_id);
 assert.match(challenge.otp_hmac,/^[0-9a-f]{64}$/);
 assert.equal(challenge.attempts,0);
 assert.ok(!challenge.otp_hmac.includes(code));

 const wrong=await verifyPilotLogin(post(BASE+"/verify",{
  challenge_id:result.challenge_id,code:code==="000000"?"123456":"000000"
 }),env,NOW+1000);
 assert.equal(wrong.status,401);
 const verified=await verifyPilotLogin(post(BASE+"/verify",{
  challenge_id:result.challenge_id,code
 }),env,NOW+2000);
 assert.equal(verified.status,200);
 const ok=await verified.json();
 assert.equal(ok.authenticated,true);
 assert.equal(ok.access_to_real_cases,false);
 const setCookie=verified.headers.get("Set-Cookie");
 assert.match(setCookie,/^__Host-daurel_v2_pilot=/);
 assert.match(setCookie,/HttpOnly/);
 assert.match(setCookie,/Secure/);
 assert.match(setCookie,/SameSite=Strict/);
 const cookie=setCookie.split(";")[0];
 const session=await getPilotSession(get(BASE+"/session",cookie),env,NOW+3000);
 assert.equal((await session.json()).authenticated,true);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_party_access").get().n,0);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_sessions").get().n,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_access_audit").get().n,1);
 const replay=await verifyPilotLogin(post(BASE+"/verify",{challenge_id:result.challenge_id,code}),env,NOW+4000);
 assert.equal(replay.status,401);
 const logout=await logoutPilotSession(post(BASE+"/logout",undefined,{Cookie:cookie}),env,NOW+5000);
 assert.equal(logout.status,200);
 assert.match(logout.headers.get("Set-Cookie"),/Max-Age=0/);
 assert.equal((await (await getPilotSession(get(BASE+"/session",cookie),env,NOW+6000)).json()).authenticated,false);
});

test("OTP piloto: límite de envío, expiración y cinco intentos",async()=>{
 const {sqlite,env}=fixture();
 let otp;
 const provider=async(_url,opts)=>{
  otp=/Tu código temporal es: (\d{6})/.exec(JSON.parse(opts.body).text)[1];return {ok:true};
 };
 const a=await (await startPilotLogin(post(BASE+"/start"),env,provider,NOW)).json();
 assert.equal((await startPilotLogin(post(BASE+"/start"),env,provider,NOW+1000)).status,429);
 let wrongCode=otp==="123456"?"654321":"123456";
 for(let i=0;i<5;i++){
  const r=await verifyPilotLogin(post(BASE+"/verify",{challenge_id:a.challenge_id,code:wrongCode}),env,NOW+2000+i);
  assert.equal(r.status,401);
 }
 assert.equal(sqlite.prepare("SELECT attempts FROM login_challenges WHERE challenge_id=?").get(a.challenge_id).attempts,5);
 assert.equal((await verifyPilotLogin(post(BASE+"/verify",{challenge_id:a.challenge_id,code:otp}),env,NOW+4000)).status,401);

 const b=await (await startPilotLogin(post(BASE+"/start"),env,provider,NOW+RATE_FIVE_MIN())).json();
 const expired=await verifyPilotLogin(post(BASE+"/verify",{challenge_id:b.challenge_id,code:otp}),env,NOW+RATE_FIVE_MIN()+10*60*1000+1);
 assert.equal(expired.status,401);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_sessions").get().n,0);
});
function RATE_FIVE_MIN(){return 5*60*1000}

test("OTP piloto: fail closed, Resend caído, CORS, secreto independiente y schema ausente",async()=>{
 const {env}=fixture();
 const noEnv=await startPilotLogin(post(BASE+"/start"),{...env,AUTH_OTP_HMAC_SECRET:undefined},
  async()=>{throw Error("No debe llamarse");},NOW);
 assert.equal(noEnv.status,503);
 const configError=await noEnv.json();
 assert.deepEqual(configError.missing_variables,["AUTH_OTP_HMAC_SECRET"]);
 assert.ok(!JSON.stringify(configError).includes("otra-clave-de-firma"));
 const noSender=await startPilotLogin(post(BASE+"/start"),
  {...env,AUTH_EMAIL_FROM:"remitente-invalido"},
  async()=>{throw Error("No debe llamar al proveedor");},NOW);
 assert.deepEqual((await noSender.json()).missing_variables,["AUTH_EMAIL_FROM"]);
 const noResend=await startPilotLogin(post(BASE+"/start"),
  {...env,RESEND_API_KEY:undefined},
  async()=>{throw Error("No debe llamar al proveedor");},NOW);
 assert.deepEqual((await noResend.json()).missing_variables,["RESEND_API_KEY"]);
 const {env:oldSchema}=fixture(false);
 assert.equal((await startPilotLogin(post(BASE+"/start"),oldSchema,
  async()=>{throw Error("No se llama");},NOW)).status,503);
 const badOrigin=await startPilotLogin(post(BASE+"/start",undefined,{Origin:"https://evil.invalid"}),env,
  async()=>({ok:true}),NOW);
 assert.equal(badOrigin.status,400);
 const providerFailed=await startPilotLogin(post(BASE+"/start"),env,async()=>({ok:false}),NOW);
 assert.equal(providerFailed.status,502);
 const {env:protectedEnv}=fixture();
 const noAuth=await worker.fetch(new Request(BASE+"/start",{method:"POST"}),protectedEnv);
 assert.equal(noAuth.status,401);
 const noAuthSession=await worker.fetch(new Request(BASE+"/session"),protectedEnv);
 assert.equal(noAuthSession.status,401);
});

test("OTP piloto: misma cuenta al reingresar y sesión expira",async()=>{
 const {sqlite,env}=fixture();
 let code;
 const provider=async(_url,init)=>{
  code=/Tu código temporal es: (\d{6})/.exec(JSON.parse(init.body).text)[1];
  return {ok:true};
 };
 const a=await (await startPilotLogin(post(BASE+"/start"),env,provider,NOW)).json();
 const v1=await verifyPilotLogin(post(BASE+"/verify",{challenge_id:a.challenge_id,code}),env,NOW+10);
 assert.equal(v1.status,200);
 const cookie=v1.headers.get("Set-Cookie").split(";")[0];
 const b=await (await startPilotLogin(post(BASE+"/start"),env,provider,NOW+6*60*1000)).json();
 const v2=await verifyPilotLogin(post(BASE+"/verify",{challenge_id:b.challenge_id,code}),env,NOW+6*60*1000+100);
 assert.equal(v2.status,200);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_emails").get().n,1);
 const future=await (await getPilotSession(get(BASE+"/session",cookie),env,NOW+8*60*60*1000+60*1000)).json();
 assert.equal(future.authenticated,false);
});
