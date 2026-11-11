// Panel operador: staging + registros ficticios, email simulado.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {operatorQueue,operatorUpdateStatus,operatorSendInvitation} from "./operator-api.js";
import {operatorActionCatalog,operatorRecordAction} from "./operator-actions.js";
import {listFollowups,createFollowup,changeFollowup} from "./followup-api.js";
import {reminderDigest,previewDailyAlerts,sendDailyAlerts} from "./daily-alerts.js";
import {newSessionToken,tokenHash} from "./auth-core.js";
import worker from "./worker.js";

const BASE="https://staging.invalid";
const TECH="clave-tecnica-operador-larga-1234567890";
const NOW=Math.floor(Date.now()/30000)*30000+10000; // Interior de la ventana de 30 s

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
 for(const name of ["0001_v2_core.sql","0002_optional_accounts.sql","0003_case_invitations.sql","0004_followup_tasks.sql"]){
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


test("Catálogo de actuaciones: intento no es contacto, respuesta sí, seguimiento sin cambio",async()=>{
 const f=await fixture(),id=f.ids[0];
 const catalog=await (await operatorActionCatalog()).json();
 assert.equal(catalog.actions.length,16);
 assert.equal(catalog.actions.find(a=>a.id==="whatsapp_attempt").auto_to,undefined);
 assert.equal(catalog.actions.find(a=>a.id==="reply_received").auto_to,"contacted");

 const post=(action,expected,idem)=>operatorRecordAction(req("/v2/operator/api/record","POST",{
  request_id:id,expected_status:expected,action,
 },{idem}),f.env);
 const first=await post("whatsapp_attempt","new","act-whats-00001");
 assert.equal(first.status,201);
 const tryBody=await first.json();
 assert.equal(tryBody.automatic_status_change,false);
 assert.equal(tryBody.status,"new");
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(id).status,"new");

 const attemptAgain=await post("whatsapp_attempt","new","act-whats-00001");
 assert.equal(attemptAgain.status,200);
 assert.equal((await attemptAgain.json()).replayed,true);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE event_type='operator_whatsapp_attempt'").get().n,1);
 assert.equal((await post("reply_received","new","act-whats-00001")).status,409);

 const responded=await post("reply_received","new","act-whats-00002");
 assert.equal(responded.status,201);
 assert.equal((await responded.json()).automatic_status_change,true);
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(id).status,"contacted");

 const requestDocs=await post("documents_requested","contacted","act-docs-00003");
 assert.equal(requestDocs.status,201);
 assert.equal((await requestDocs.json()).status,"contacted");
 const receipt=await post("documents_received","contacted","act-docs-00004");
 assert.equal(receipt.status,201);
 assert.equal((await receipt.json()).automatic_status_change,false);
 const reviewed=await post("documents_reviewed","contacted","act-docs-00005");
 assert.equal(reviewed.status,201);
 assert.equal((await reviewed.json()).status,"in_attention");
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(id).status,"in_attention");

 const followup=await post("followup_done","in_attention","act-followup-06");
 assert.equal(followup.status,201);
 assert.equal((await followup.json()).automatic_status_change,false);
 const done=await post("service_completed","in_attention","act-close-00007");
 assert.equal(done.status,201);
 assert.equal((await done.json()).status,"closed");
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(f.ids[1]).status,"new");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE request_id=?").get(id).n,7);
});

test("Actuaciones restringidas a operador, sólo sintéticas, con origen y estado esperado",async()=>{
 const f=await fixture(),id=f.ids[0],path="/v2/operator/api/record";
 const data={request_id:id,expected_status:"new",action:"reply_received"};
 assert.equal((await worker.fetch(req(path,"POST",data,{tech:false,cookie:f.cookie,idem:"act-test-0001"}),f.env)).status,401);
 assert.equal((await worker.fetch(req(path,"POST",data,{badToken:true,idem:"act-test-0001"}),f.env)).status,401);
 assert.equal((await worker.fetch(req(path,"GET",undefined,{tech:false,cookie:f.cookie}),f.env)).status,404);
 assert.equal((await worker.fetch(req("/v2/operator/api/actions","GET",undefined,{tech:false}),f.env)).status,401);
 assert.equal((await worker.fetch(req("/v2/operator/api/actions"),f.env)).status,200);
 const outside=await operatorRecordAction(req(path,"POST",data,{origin:"https://evil.invalid",idem:"act-test-0001"}),f.env);
 assert.equal(outside.status,403);
 const bad=await operatorRecordAction(req(path,"POST",{...data,action:"inventado"},{idem:"act-test-0001"}),f.env);
 assert.equal(bad.status,400);
 const stale=await operatorRecordAction(req(path,"POST",{...data,expected_status:"contacted"},{idem:"act-test-0002"}),f.env);
 assert.equal(stale.status,409);
 const unrelated=await operatorRecordAction(req(path,"POST",{...data,request_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},{idem:"act-test-0003"}),f.env);
 assert.equal(unrelated.status,404);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events").get().n,0);
 const html=await (await worker.fetch(req("/v2/operator"),f.env)).text();
 assert.match(html,/Registrar actuación/);
 assert.match(html,/visibilitychange/);
 assert.match(html,/WhatsApp personal no está conectado/);
});

test("Actuaciones: cita y envío de correo no alteran estado; expediente cerrado no acepta avance",async()=>{
 const f=await fixture(),id=f.ids[0];
 const post=(action,expected,idem)=>operatorRecordAction(req("/v2/operator/api/record","POST",{
  request_id:id,expected_status:expected,action,
 },{idem}),f.env);
 assert.equal((await post("appointment_scheduled","new","act-appointment")).status,201);
 assert.equal((await post("email_sent","new","act-email-00001")).status,201);
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(id).status,"new");
 assert.equal((await post("call_answered","new","act-call-00002")).status,201);
 assert.equal((await post("consultation_completed","contacted","act-attend-0003")).status,201);
 assert.equal((await post("service_completed","in_attention","act-finish-0004")).status,201);
 assert.equal((await post("documents_reviewed","closed","act-review-0005")).status,409);
 assert.equal((await post("followup_done","closed","act-followup-0006")).status,201);
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(id).status,"closed");
});


test("Agenda: crea pendientes sin cuenta, calcula semáforo y registra historial",async()=>{
 const f=await fixture(),id=f.ids[0],path="/v2/operator/api/followups/create";
 const initial=await (await listFollowups(f.env,NOW)).json();
 assert.equal(initial.count,0);
 const addDays=(day,n)=>new Date(Date.parse(day+"T12:00:00Z")+n*86400000).toISOString().slice(0,10);
 const today=initial.today,soon=addDays(today,2),future=addDays(today,6);
 const dueBody=(code,date)=>({request_id:id,action_code:code,due_date:date});
 async function create(body,key){
  return worker.fetch(req(path,"POST",body,{idem:key}),f.env);
 }
 const first=await create(dueBody("contact_again",today),"followup-key-0001");
 assert.equal(first.status,201);
 const task1=(await first.json()).task_id;
 const again=await create(dueBody("contact_again",today),"followup-key-0001");
 assert.equal(again.status,200);
 assert.equal((await again.json()).replayed,true);
 assert.equal((await create(dueBody("contact_again",today),"followup-key-0002")).status,409);
 assert.equal((await create(dueBody("review_documents",soon),"followup-key-0003")).status,201);
 assert.equal((await create(dueBody("check_deadline",future),"followup-key-0004")).status,201);
 const listed=await (await listFollowups(f.env,NOW)).json();
 assert.equal(listed.count,3);
 assert.equal(listed.summary.overdue,0);
 assert.equal(listed.summary.soon,2);
 assert.equal(listed.summary.planned,1);
 assert.equal(listed.tasks[0].task_id,task1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM followup_tasks").get().n,3);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE event_type='followup_scheduled'").get().n,3);
 const past=addDays(today,-1),pastId="followup-"+"f".repeat(64);
 f.sqlite.prepare("INSERT INTO followup_tasks(task_id,request_id,action_code,due_date) VALUES (?,?,?,?)")
  .run(pastId,id,"update_client",past);
 const withPast=await (await listFollowups(f.env,NOW)).json();
 assert.equal(withPast.summary.overdue,1);
 assert.equal(withPast.tasks[0].signal,"red");
 const countOther=f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE request_id=?").get(f.ids[1]).n;
 assert.equal(countOther,0);
});

test("Agenda: completar, cancelar, replay y aislar expedientes",async()=>{
 const f=await fixture(),id=f.ids[1];
 const initial=await (await listFollowups(f.env,NOW)).json();
 const due=initial.today;
 const created=await createFollowup(req("/v2/operator/api/followups/create","POST",
  {request_id:id,action_code:"followup_authority",due_date:due},
  {idem:"task-complete-001"}),f.env,NOW);
 assert.equal(created.status,201);
 const task=(await created.json()).task_id;
 const doneBody={task_id:task,confirm:"confirmar-pendiente"};
 const complete=await worker.fetch(req("/v2/operator/api/followups/complete","POST",doneBody),f.env);
 assert.equal(complete.status,200);
 assert.equal((await complete.json()).status,"completed");
 const again=await worker.fetch(req("/v2/operator/api/followups/complete","POST",doneBody),f.env);
 assert.equal(again.status,200);
 assert.equal((await again.json()).replayed,true);
 const cancel=await worker.fetch(req("/v2/operator/api/followups/cancel","POST",
  {task_id:task,confirm:"cancelar-pendiente"}),f.env);
 assert.equal(cancel.status,409);
 assert.equal((await (await listFollowups(f.env,NOW)).json()).count,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE event_type='followup_completed'").get().n,1);
 const due2=new Date(Date.parse(due+"T12:00:00Z")+86400000).toISOString().slice(0,10);
 const another=await createFollowup(req("/v2/operator/api/followups/create","POST",
  {request_id:id,action_code:"request_documents",due_date:due2},
  {idem:"task-cancel-0001"}),f.env,NOW);
 assert.equal(another.status,201);
 const task2=(await another.json()).task_id;
 const canceled=await worker.fetch(req("/v2/operator/api/followups/cancel","POST",
  {task_id:task2,confirm:"cancelar-pendiente"}),f.env);
 assert.equal(canceled.status,200);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM request_events WHERE event_type='followup_cancelled'").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM followup_tasks WHERE status='completed'").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM followup_tasks WHERE status='cancelled'").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT status FROM service_requests WHERE request_id=?").get(id).status,"new");
});

test("Agenda: solo operador y casos ficticios, no clientes ni producción",async()=>{
 const f=await fixture(),id=f.ids[0],path="/v2/operator/api/followups/create";
 const date=(await (await listFollowups(f.env,NOW)).json()).today;
 const data={request_id:id,action_code:"contact_again",due_date:date};
 assert.equal((await worker.fetch(req("/v2/operator/api/followups","GET",undefined,{tech:false,cookie:f.cookie}),f.env)).status,401);
 assert.equal((await worker.fetch(req(path,"POST",data,{tech:false,cookie:f.cookie,idem:"test-no-auth-1"}),f.env)).status,401);
 assert.equal((await worker.fetch(req(path,"POST",data,{badToken:true,idem:"test-bad-key-1"}),f.env)).status,401);
 assert.equal((await worker.fetch(req(path,"POST",data,{idem:"test-nonprod-1"}),{...f.env,ENVIRONMENT:"production"})).status,403);
 assert.equal((await createFollowup(req(path,"POST",data,{origin:"https://other.invalid",idem:"test-origin-1"}),f.env,NOW)).status,403);
 assert.equal((await createFollowup(req(path,"POST",{...data,action_code:"inventado"},{idem:"test-action-1"}),f.env,NOW)).status,400);
 assert.equal((await createFollowup(req(path,"POST",{...data,due_date:"2026-02-30"},{idem:"test-date-001"}),f.env,NOW)).status,400);
 assert.equal((await createFollowup(req(path,"POST",{...data,request_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},{idem:"test-missing1"}),f.env,NOW)).status,404);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM followup_tasks").get().n,0);
 f.sqlite.exec("DROP TABLE followup_tasks");
 const unavailable=await listFollowups(f.env,NOW);
 assert.equal(unavailable.status,503);
 assert.match((await unavailable.json()).message,/0004_followup_tasks\.sql/);
});

test("Panel operador contiene agenda móvil y semáforo y puede cargar sin tabla 0004",async()=>{
 const f=await fixture();
 const html=await (await worker.fetch(req("/v2/operator"),f.env)).text();
 assert.match(html,/Agenda de próximos pasos/);
 assert.match(html,/id="a-red"/);
 assert.match(html,/Programar pendiente/);
 assert.match(html,/visibilitychange/);
 assert.match(html,/loadFollowups/);
 assert.ok(!html.includes("daurel-db"));
});


test("Alertas: vista previa solo con operador, resumen seguro sin WhatsApp ni secretos",async()=>{
 const f=await fixture();
 const day=(await (await listFollowups(f.env,NOW)).json()).today;
 const tomorrow=new Date(Date.parse(day+"T12:00:00Z")+86400000).toISOString().slice(0,10);
 const taskId="followup-"+"a".repeat(64);
 f.sqlite.prepare("INSERT INTO followup_tasks(task_id,request_id,action_code,due_date) VALUES (?,?,?,?)")
   .run(taskId,f.ids[0],"contact_again",tomorrow);
 const noKey=await worker.fetch(req("/v2/operator/api/alerts/preview","GET",undefined,{tech:false,cookie:f.cookie}),f.env);
 assert.equal(noKey.status,401);
 const preview=await worker.fetch(req("/v2/operator/api/alerts/preview"),f.env);
 assert.equal(preview.status,200);
 const body=await preview.json();
 assert.equal(body.success,true);
 assert.equal(body.delivery_enabled,false);
 assert.equal(body.telegram_configured,false);
 assert.equal(body.sending_active,false);
 assert.equal(body.cron_utc,"0 15 * * *");
 assert.equal(body.preview.count,1);
 assert.equal(body.preview.counts.tomorrow,1);
 assert.match(body.preview.text,/DAU-TEST-0001/);
 assert.match(body.preview.text,/MAÑANA/);
 assert.ok(!JSON.stringify(body).includes("clave-tecnica-operador"));
 assert.ok(!JSON.stringify(body).includes("daurelcontact@gmail.com"));
 const page=await (await worker.fetch(req("/v2/operator"),f.env)).text();
 assert.match(page,/Recordatorios en Telegram/);
 assert.match(page,/Ver mensaje de ejemplo/);
});

test("Telegram: envía máximo un resumen diario si se habilita expresamente",async()=>{
 const f=await fixture(),day=(await (await listFollowups(f.env,NOW)).json()).today;
 const key="followup-"+"b".repeat(64);
 f.sqlite.prepare("INSERT INTO followup_tasks(task_id,request_id,action_code,due_date) VALUES (?,?,?,?)")
  .run(key,f.ids[0],"check_deadline",day);
 const env={...f.env,DAUREL_V2_ALERTS_ENABLED:"true",
  DAUREL_V2_TELEGRAM_CHAT_ID:"123456789",
  DAUREL_V2_TELEGRAM_BOT_TOKEN:"123456:abcdefghijklmnopqrstuvwxyz123456789"};
 const sends=[];
 const mock=async(url,init)=>{
  sends.push({url,init});
  assert.equal(init.method,"POST");
  const payload=JSON.parse(init.body);
  assert.equal(payload.chat_id,"123456789");
  assert.ok(payload.text.includes("DAU-TEST-0001"));
  assert.ok(!payload.text.includes("demo-cliente1"));
  assert.ok(!payload.text.includes("daurelcontact@gmail.com"));
  return {ok:true,json:async()=>({ok:true,result:{message_id:17}})};
 };
 const first=await sendDailyAlerts(env,NOW,mock);
 assert.equal(first.sent,true);
 assert.equal(first.count,1);
 assert.equal(sends.length,1);
 const second=await sendDailyAlerts(env,NOW,mock);
 assert.deepEqual(second,{sent:false,reason:"already_sent"});
 assert.equal(sends.length,1);
 const logs=f.sqlite.prepare([
  "SELECT status FROM integration_events WHERE provider='telegram-staging'",
  "AND source_scope='staging-followup-daily'",
 ].join(" ")).all();
 assert.equal(logs.length,1);
 assert.equal(logs[0].status,"completed");
 const disabled=await sendDailyAlerts({...env,DAUREL_V2_ALERTS_ENABLED:"false"},NOW,mock);
 assert.equal(disabled.reason,"not_enabled");
 assert.equal(sends.length,1);
});

test("Telegram: no envía sin pendientes, nunca desde producción y conserva reintento tras error",async()=>{
 const f=await fixture(),day=(await (await listFollowups(f.env,NOW)).json()).today;
 const env={...f.env,DAUREL_V2_ALERTS_ENABLED:"true",
  DAUREL_V2_TELEGRAM_CHAT_ID:"123456789",
  DAUREL_V2_TELEGRAM_BOT_TOKEN:"123456:abcdefghijklmnopqrstuvwxyz123456789"};
 const noTasks=await sendDailyAlerts(env,NOW,async()=>{throw Error("No debería llamar Telegram")});
 assert.equal(noTasks.reason,"no_due_tasks");
 const nonStaging=await sendDailyAlerts({...env,ENVIRONMENT:"production"},NOW,async()=>{throw Error("No debería llamar")});
 assert.equal(nonStaging.reason,"not_staging");
 const taskId="followup-"+"c".repeat(64);
 f.sqlite.prepare("INSERT INTO followup_tasks(task_id,request_id,action_code,due_date) VALUES (?,?,?,?)")
  .run(taskId,f.ids[1],"review_documents",day);
 const failed=await sendDailyAlerts(env,NOW,async()=>({ok:false,json:async()=>({ok:false})}));
 assert.equal(failed.reason,"delivery_failed");
 const status=f.sqlite.prepare("SELECT status FROM integration_events WHERE provider='telegram-staging'").get();
 assert.equal(status.status,"failed");
 let sent=0;
 const retry=await sendDailyAlerts(env,NOW,async()=>{sent++;return {ok:true,json:async()=>({ok:true})}});
 assert.equal(retry.sent,true);
 assert.equal(sent,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM integration_events WHERE provider='telegram-staging'").get().n,1);
 const idempotent=await sendDailyAlerts(env,NOW,async()=>{throw Error("no second send")});
 assert.equal(idempotent.reason,"already_sent");
});

test("Cron: sin configuración opt-in no envía y solo actúa con cron de staging",async()=>{
 const f=await fixture();
 const config=await previewDailyAlerts(f.env,NOW);
 assert.equal((await config.json()).sending_active,false);
 await worker.scheduled({cron:"0 15 * * *",scheduledTime:NOW},f.env,{});
 await worker.scheduled({cron:"*/5 * * * *",scheduledTime:NOW},f.env,{});
 await worker.scheduled({cron:"0 15 * * *",scheduledTime:NOW},{...f.env,ENVIRONMENT:"production"},{});
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM integration_events WHERE provider='telegram-staging'").get().n,0);
});
