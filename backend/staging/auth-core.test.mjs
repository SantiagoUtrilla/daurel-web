// Esquema de cuentas opcionales y primitivas offline. No envía emails.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  normalizeEmail, newOtp, otpHmac, timingSafeHexEqual,
  newSessionToken, tokenHash, allowedPartiesForAccount,
} from "./auth-core.js";
import {sendLoginCode} from "./email-provider.js";

const SECRET="secreto-sintetico-hmac-de-minimo-32-caracteres-abcXYZ";
const UUID="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function db(){
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON;");
  sqlite.exec(readFileSync(new URL("../migrations/0001_v2_core.sql", import.meta.url),"utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0002_optional_accounts.sql", import.meta.url),"utf8"));
  return sqlite;
}
function adapter(sqlite){
  return {
    prepare(sql) {
      return {bind:(...args)=>({all:async()=>({results:sqlite.prepare(sql).all(...args)})})};
    },
  };
}

test("Esquema de cuentas opcionales no exige cuenta para una solicitud",()=>{
  const sqlite=db();
  const names=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
  for(const name of ["accounts","account_emails","account_party_access","login_challenges",
    "account_sessions","auth_rate_limits","account_access_audit"])assert.ok(names.includes(name));
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,?)").run("client-1","person");
  sqlite.prepare("INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary) VALUES (?,?,?,?)")
    .run("request-1","DAU-TEST-0001","client-1","Solicitud ficticia");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM service_requests").get().n,1);
});

test("Correo verificado se asigna a una sola cuenta; no concede expediente",async()=>{
  const sqlite=db();
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,?)").run("client-1","person");
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run("acct-1");
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run("acct-2");
  sqlite.prepare("INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at) VALUES (?,?,?,CURRENT_TIMESTAMP)")
    .run("email-1","acct-1","example@domain.test");
  assert.throws(()=>sqlite.prepare(
    "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at) VALUES (?,?,?,CURRENT_TIMESTAMP)"
  ).run("email-2","acct-2","EXAMPLE@DOMAIN.TEST"),/UNIQUE/i);
  assert.deepEqual(await allowedPartiesForAccount(adapter(sqlite),"acct-1"),[]);
  sqlite.prepare("INSERT INTO account_party_access(account_id,party_id,grant_basis) VALUES (?,?,?)")
    .run("acct-1","client-1","verified_intake");
  const allowed=await allowedPartiesForAccount(adapter(sqlite),"acct-1");
  assert.equal(allowed.length,1);
  assert.equal(allowed[0].party_id,"client-1");
  assert.deepEqual(await allowedPartiesForAccount(adapter(sqlite),"acct-2"),[]);
  sqlite.prepare("UPDATE account_party_access SET revoked_at=CURRENT_TIMESTAMP WHERE account_id=?").run("acct-1");
  assert.deepEqual(await allowedPartiesForAccount(adapter(sqlite),"acct-1"),[]);
});

test("OTP criptográfico no se guarda en texto claro y no coincide con otro desafío",async()=>{
  assert.equal(normalizeEmail(" EXAMPLE@domain.test "),"example@domain.test");
  assert.equal(normalizeEmail("foo@@example.com"),null);
  assert.equal(normalizeEmail("example@example..com"),null);
  const otp=newOtp();
  assert.match(otp,/^\d{6}$/);
  const actual=await otpHmac("Example@domain.test",UUID,otp,SECRET);
  const again=await otpHmac("example@domain.test",UUID,otp,SECRET);
  const wrong=await otpHmac("example@domain.test",UUID,otp==="000000"?"000001":"000000",SECRET);
  assert.equal(actual,again);
  assert.equal(timingSafeHexEqual(actual,again),true);
  assert.equal(timingSafeHexEqual(actual,wrong),false);
  assert.equal(timingSafeHexEqual(actual,"1234"),false);
});

test("Sesiones usan tokens opacos aleatorios: solo se almacena hash",async()=>{
  const a=newSessionToken(), b=newSessionToken();
  assert.match(a,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a,b);
  const hash=await tokenHash(a);
  assert.match(hash,/^[0-9a-f]{64}$/);
  assert.notEqual(hash,a);
  assert.notEqual(hash,await tokenHash(b));
});

test("Desafíos y sesiones tienen límites y vencimientos definidos por base",()=>{
  const sqlite=db();
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run("acct-1");
  sqlite.prepare("INSERT INTO login_challenges(challenge_id,email_normalized,otp_hmac,expires_at) VALUES (?,?,?,?)")
    .run("challenge-1","example@domain.test","testhash","2099-01-01 00:00:00");
  assert.throws(()=>sqlite.prepare("UPDATE login_challenges SET attempts=6 WHERE challenge_id='challenge-1'").run(),/CHECK/i);
  sqlite.prepare("INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at) VALUES (?,?,?,?)")
    .run("session-1","acct-1","hash-1","2099-01-01");
  assert.throws(()=>sqlite.prepare(
    "INSERT INTO account_sessions(session_id,account_id,token_sha256,expires_at) VALUES (?,?,?,?)"
  ).run("session-2","acct-1","hash-1","2099-01-01"),/UNIQUE/i);
});

test("Resend no envía sin configuración y protege el secreto/código",async()=>{
  let calls=0;
  const fakeFetch=async(url,init)=>{
    calls++;
    assert.equal(url,"https://api.resend.com/emails");
    assert.equal(init.headers.Authorization,"Bearer clave-prueba-que-no-debe-compartirse");
    const body=JSON.parse(init.body);
    assert.equal(body.from,"DAUREL <acceso@daurel.com.mx>");
    assert.deepEqual(body.to,["persona@example.com"]);
    assert.match(body.text,/123456/);
    assert.equal(body.subject,"Tu código de acceso a DAUREL");
    return {ok:true};
  };
  const disabled=await sendLoginCode("persona@example.com","123456",UUID,{},fakeFetch);
  assert.equal(disabled.accepted,false);
  assert.equal(disabled.reason,"not_configured");
  assert.equal(calls,0);
  const enabled=await sendLoginCode("PERSONA@example.com","123456",UUID,
    {RESEND_API_KEY:"clave-prueba-que-no-debe-compartirse",AUTH_EMAIL_FROM:"acceso@daurel.com.mx"},fakeFetch);
  assert.deepEqual(enabled,{accepted:true});
  assert.equal(calls,1);
});
