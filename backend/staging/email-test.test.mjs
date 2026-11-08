// Prueba offline del envío de correo DAUREL: jamás llama a Resend real.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sendStagingDeliveryProbe } from "./email-test-api.js";
import worker from "./worker.js";

const SECRET="clave-de-staging-de-pruebas-muy-larga-test-123456";
function db() {
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(readFileSync(new URL("../migrations/0001_v2_core.sql",import.meta.url),"utf8"));
  const d1={
    prepare(sql){
      const make=(args)=>({
        run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
        first:async()=>sqlite.prepare(sql).get(...args)||null,
        all:async()=>({results:sqlite.prepare(sql).all(...args)})
      });
      return {...make([]),bind:(...args)=>make(args)};
    }
  };
  return {sqlite,d1};
}
function env(d1) {
  return {DB:d1,ENVIRONMENT:"staging",STAGING_TEST_TOKEN:SECRET,
    RESEND_API_KEY:"re_este-es-un-token-falso-solamente-para-test",
    AUTH_EMAIL_FROM:"acceso@daurel.com.mx"};
}
function req(body) {
  return new Request("https://staging.invalid/v2/demo/mail/test", {
    method:"POST",body:body===undefined?undefined:body
  });
}

test("Resend: destinatario fijo, remitente validado y límite de un envío por minuto",async()=>{
  const {sqlite,d1}=db();
  let outbound=0;
  const transport=async(url,init)=>{
    outbound++;
    assert.equal(url,"https://api.resend.com/emails");
    assert.equal(init.headers.Authorization,"Bearer re_este-es-un-token-falso-solamente-para-test");
    const payload=JSON.parse(init.body);
    assert.deepEqual(payload.to,["daurelcontact@gmail.com"]);
    assert.equal(payload.from,"DAUREL <acceso@daurel.com.mx>");
    assert.match(payload.text,/no contiene un código/i);
    assert.ok(!init.body.includes("STAGING_TEST_TOKEN"));
    return {ok:true};
  };
  const fakeEnv=env(d1);
  const first=await sendStagingDeliveryProbe(req(),fakeEnv,transport,620000);
  assert.equal(first.status,202);
  assert.equal((await first.json()).accepted,true);
  assert.equal(outbound,1);
  const repeat=await sendStagingDeliveryProbe(req(),fakeEnv,transport,620000);
  assert.equal(repeat.status,429);
  assert.equal(outbound,1);
  const next=await sendStagingDeliveryProbe(req(),fakeEnv,transport,680000);
  assert.equal(next.status,202);
  assert.equal(outbound,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM integration_events WHERE provider = 'resend_staging_test'").get().n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM integration_events WHERE status = 'completed'").get().n,2);
});

test("Resend: rechaza body, falta de configuración y permite reintento tras fallo del proveedor",async()=>{
  const {sqlite,d1}=db(),fakeEnv=env(d1);
  let outbound=0;
  const f=async()=>{outbound++;return {ok:false}};
  assert.equal((await sendStagingDeliveryProbe(req('{"to":"another@domain.test"}'),fakeEnv,f,620000)).status,400);
  assert.equal(outbound,0);
  assert.equal((await sendStagingDeliveryProbe(req(),{...fakeEnv,AUTH_EMAIL_FROM:""},f,620000)).status,503);
  assert.equal(outbound,0);
  const failed=await sendStagingDeliveryProbe(req(),fakeEnv,f,620000);
  assert.equal(failed.status,502);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM integration_events").get().n,0);
  const retry=await sendStagingDeliveryProbe(req(),fakeEnv,async()=>{outbound++;return {ok:true}},620000);
  assert.equal(retry.status,202);
  assert.equal(outbound,2);
});

test("Resend: la ruta no permite enviar sin autorización",async()=>{
  const {d1}=db(),fakeEnv=env(d1);
  const noAuth=await worker.fetch(req(),fakeEnv);
  assert.equal(noAuth.status,401);
  const bad=await worker.fetch(new Request("https://staging.invalid/v2/demo/mail/test",{
    method:"POST",headers:{Authorization:"Bearer clave-incorrecta-que-no-es-real-123"}
  }),fakeEnv);
  assert.equal(bad.status,401);
});
