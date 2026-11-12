import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {operatorAuditLog} from "./operator-audit.js";
import {operatorPageResponse} from "./operator-page.js";

const BASE="https://staging.invalid/v2/operator/api/audit";
function fixture(){
 const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");
 for(const file of ["0001_v2_core.sql","0002_optional_accounts.sql","0006_operator_identity.sql"])
  db.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 db.prepare("INSERT INTO accounts(account_id) VALUES('owner')").run();
 db.prepare([
  "INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at)",
  "VALUES('mail','owner','daurelcontact@gmail.com',CURRENT_TIMESTAMP)",
 ].join(" ")).run();
 for(let i=0;i<24;i++){
  const time="2026-11-"+String((i%3)+11).padStart(2,"0")+" 12:00:"+String(i).padStart(2,"0");
  db.prepare([
   "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation,created_at)",
   "VALUES (?,'owner','operator_action','Operación confirmada',?)",
  ].join(" ")).run("audit-nov-"+String(i).padStart(3,"0"),time);
 }
 for(let i=0;i<4;i++){
  db.prepare([
   "INSERT INTO operator_access_audit(audit_id,account_id,event_type,operation,created_at)",
   "VALUES (?,'owner','operator_login',NULL,'2026-10-05 16:02:00')",
  ].join(" ")).run("audit-oct-"+i);
 }
 const DB={prepare:(sql)=>{
  const bind=(args=[])=>({
   bind:(...values)=>bind(values),
   first:async()=>db.prepare(sql).get(...args)||null,
   all:async()=>({results:db.prepare(sql).all(...args)}),
  });return bind();
 }};
 return {db,env:{DB,ENVIRONMENT:"staging"},actor:{role:"owner",account_id:"owner"}};
}
function req(q=""){return new Request(BASE+q)}
test("Bitácora limita resultados a diez por página, conserva totales y el historial de otras páginas",async()=>{
 const f=fixture();
 const first=await (await operatorAuditLog(f.env,f.actor,req())).json();
 assert.equal(first.success,true);
 assert.equal(first.page,1);assert.equal(first.page_size,10);
 assert.equal(first.total,28);
 assert.equal(first.events.length,10);
 assert.equal(first.has_next,true);
 assert.equal(first.has_previous,false);
 const second=await (await operatorAuditLog(f.env,f.actor,req("?page=2"))).json();
 assert.equal(second.events.length,10);
 assert.equal(second.total,28);
 assert.equal(second.has_next,true);
 const third=await (await operatorAuditLog(f.env,f.actor,req("?page=3"))).json();
 assert.equal(third.events.length,8);assert.equal(third.has_next,false);
 assert.ok(third.events.some(e=>e.date.startsWith("2026-10")));
 assert.ok([...first.events,...second.events,...third.events].every(e=>!Object.hasOwn(e,"account_id")));
});
test("Calendario mensual muestra conteos por día UTC, no carga operaciones ni datos sensibles",async()=>{
 const f=fixture();
 const res=await operatorAuditLog(f.env,f.actor,req("?view=calendar&month=2026-11"));
 assert.equal(res.status,200);
 assert.equal(res.headers.get("Cache-Control"),"no-store");
 const data=await res.json();
 assert.equal(data.view,"calendar");assert.equal(data.total,24);
 assert.equal(data.days.length,3);
 assert.deepEqual(data.days.map(x=>x.count),[8,8,8]);
 assert.deepEqual(data.days.map(x=>x.date),["2026-11-11","2026-11-12","2026-11-13"]);
 assert.ok(!JSON.stringify(data).includes("daurelcontact@gmail.com"));
 const other=await (await operatorAuditLog(f.env,f.actor,req("?view=calendar&month=2026-10"))).json();
 assert.equal(other.total,4);
});
test("Filtrar por mes y día no mezcla casos; fecha inválida y otros parámetros se rechazan",async()=>{
 const f=fixture();
 const month=await (await operatorAuditLog(f.env,f.actor,req("?view=list&month=2026-10&page=1"))).json();
 assert.equal(month.total,4);assert.equal(month.events.length,4);
 const day=await (await operatorAuditLog(f.env,f.actor,
  req("?view=list&month=2026-11&date=2026-11-12"))).json();
 assert.equal(day.total,8);
 assert.ok(day.events.every(e=>e.date.startsWith("2026-11-12")));
 for(const bad of ["?page=0","?page=1001","?page=-1","?view=edit",
  "?view=calendar&page=1","?view=calendar&date=2026-11-12",
  "?month=2026-13","?date=2026-02-30","?month=2026-10&date=2026-11-12",
  "?secret=1","?page=1&page=1"]){
  const response=await operatorAuditLog(f.env,f.actor,req(bad));
  assert.equal(response.status,400,bad);
 }
});
test("Solo propietario en staging puede leer ambas vistas, sin acceso del lector ni del entorno real",async()=>{
 const f=fixture();
 for(const view of ["?view=list","?view=calendar&month=2026-11"]){
  assert.equal((await operatorAuditLog(f.env,{role:"reader"},req(view))).status,403);
  assert.equal((await operatorAuditLog(f.env,{role:"manager"},req(view))).status,403);
  assert.equal((await operatorAuditLog({...f.env,ENVIRONMENT:"production"},f.actor,req(view))).status,403);
 }
});
test("Interfaz de bitácora ofrece lista paginada y calendario, con sección acotada",async()=>{
 const html=await operatorPageResponse().text();
 for(const id of ["audit-view-list","audit-view-calendar","audit-month",
  "audit-entries","audit-calendar","audit-prev","audit-next","audit-clear"])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes("max-height:430px"));
 assert.ok(html.includes("10 por página"));
});
