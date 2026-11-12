// Laboratorio V2 — distribución de expedientes sin mutación automática.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {operatorRoutingOverview} from "./operator-routing.js";
import {roleAllows} from "./operator-auth.js";
import {operatorPageResponse} from "./operator-page.js";

const BASE="https://staging.invalid/v2/operator/api/routing";
function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const f of ["0001_v2_core.sql","0002_optional_accounts.sql",
  "0006_operator_identity.sql","0007_operator_approvals.sql"]){
  sqlite.exec(readFileSync(new URL("../migrations/"+f,import.meta.url),"utf8"));
 }
 const prepare=sql=>{
  const build=(values=[])=>({
   bind:(...next)=>build(next),
   all:async()=>({results:sqlite.prepare(sql).all(...values)}),
   first:async()=>sqlite.prepare(sql).get(...values)||null,
   run:async()=>({meta:sqlite.prepare(sql).run(...values)}),
  });return build();
 };
 const env={DB:{prepare},ENVIRONMENT:"staging"};
 const accounts=[
  ["owner","owner"],["manager","manager"],["reader","reader"],
  ["disabled","manager"],["unverified","manager"],
 ];
 for(const [account,role] of accounts){
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES(?)").run(account);
  sqlite.prepare("INSERT INTO operator_memberships(account_id,role,status) VALUES(?,?,?)")
   .run(account,role,account==="disabled"?"disabled":"active");
  if(account!=="owner"){
   const email=account+"@example.invalid";
   sqlite.prepare("INSERT INTO operator_approved_emails(email_normalized,account_id,approved_by_account_id) VALUES(?,?,'owner')").run(email,account);
   if(account!=="unverified"){
    sqlite.prepare("INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP)")
     .run("mail-"+account,account,email);
   }
  }
 }
 const summaries=[
  "Solicitud ficticia: consulta laboral",
  "Solicitud ficticia: orientación contable",
  "Solicitud ficticia: asunto civil",
  "Solicitud ficticia: orientación general",
  "Solicitud ficticia: registro de marca",
  "Servicio desconocido de ingeniería",
 ];
 for(let i=0;i<summaries.length;i++){
  const id="11111111-1111-4111-8111-"+String(i+1).padStart(12,"0");
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES(?,'person')").run("p-"+i);
  sqlite.prepare([
   "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel,priority,status)",
   "VALUES (?,?,?,?,'staging_demo',?,?)",
  ].join(" ")).run(id,"DAU-SIM-"+i,"p-"+i,summaries[i],
    i===3?"high":"normal",i===5?"closed":"new");
 }
 const id=i=>"11111111-1111-4111-8111-"+String(i+1).padStart(12,"0");
 const grant=(account,i)=>{
  sqlite.prepare([
   "INSERT INTO operator_case_assignments(account_id,request_id,assigned_by_account_id)",
   "VALUES (?,?,'owner')",
  ].join(" ")).run(account,id(i));
 };
 grant("manager",0); // Cuenta de gestor verificada: ya atendido
 grant("reader",1); // Lector no cuenta como responsable
 grant("disabled",2); // Desactivado: sin responsable
 grant("unverified",4); // Gestor sin correo verificado: sin responsable
 sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES('p-real','person')").run();
 sqlite.prepare([
  "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
  "VALUES ('33333333-3333-4333-8333-333333333333','DAU-REAL','p-real',?,'legacy_v1_web')",
 ].join(" ")).run(summaries[0]);
 return {sqlite,env,actor:{role:"owner",account_id:"owner"}};
}
const req=(query="")=>new Request(BASE+query);

test("Distribución global filtra solo solicitudes ficticias abiertas y distingue lector de gestor",async()=>{
 const f=fixture();
 const response=await operatorRoutingOverview(f.env,f.actor,req());
 assert.equal(response.status,200);
 assert.equal(response.headers.get("Cache-Control"),"no-store");
 const data=await response.json();
 assert.equal(data.assignment_mode,"manual_only");
 assert.equal(data.scope,"pending");
 assert.equal(data.total,4);
 assert.deepEqual(data.areas,{
  juridica:{total:3,pending:2},
  contaduria:{total:1,pending:1},
  por_clasificar:{total:1,pending:1},
 });
 assert.ok(!JSON.stringify(data).includes("DAU-REAL"));
 assert.ok(!JSON.stringify(data).includes("Servicio desconocido de ingeniería"));
 assert.ok(!data.cases.some(c=>c.public_folio==="DAU-SIM-0"));
 assert.ok(data.cases.some(c=>c.public_folio==="DAU-SIM-1"));
 assert.ok(data.cases.some(c=>c.public_folio==="DAU-SIM-2"));
 assert.ok(data.cases.every(c=>c.has_verified_manager===false));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM operator_case_assignments").get().n,4);
});
test("Filtra áreas y conserva prioridad alta, pero evita asignación automática",async()=>{
 const f=fixture();
 const areas=await (await operatorRoutingOverview(f.env,f.actor,req("?area=juridica&scope=all"))).json();
 assert.equal(areas.total,3);
 assert.equal(areas.cases[0].public_folio,"DAU-SIM-2");
 assert.equal(areas.cases.at(-1).public_folio,"DAU-SIM-0");
 assert.ok(areas.cases.at(-1).has_verified_manager);
 const unclassified=await (await operatorRoutingOverview(f.env,f.actor,req("?area=por_clasificar"))).json();
 assert.equal(unclassified.total,1);
 assert.equal(unclassified.cases[0].public_folio,"DAU-SIM-3");
 const accounting=await (await operatorRoutingOverview(f.env,f.actor,req("?area=contaduria"))).json();
 assert.equal(accounting.total,1);
 assert.equal(accounting.cases[0].public_folio,"DAU-SIM-1");
});
test("El listado de distribución pagina en servidor, no carga miles de elementos a la vez",async()=>{
 const f=fixture();
 for(let i=10;i<55;i++){
  const id="22222222-2222-4222-8222-"+String(i).padStart(12,"0");
  const party="page-"+i;
  f.sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").run(party);
  f.sqlite.prepare([
   "INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel)",
   "VALUES (?,?,?,'Solicitud ficticia: consulta laboral','staging_demo')",
  ].join(" ")).run(id,"DAU-PAGE-"+i,party);
 }
 const first=await (await operatorRoutingOverview(f.env,f.actor,req())).json();
 const second=await (await operatorRoutingOverview(f.env,f.actor,req("?page=2"))).json();
 const third=await (await operatorRoutingOverview(f.env,f.actor,req("?page=3"))).json();
 assert.equal(first.total,49);
 assert.equal(first.cases.length,20);
 assert.equal(second.cases.length,20);
 assert.equal(third.cases.length,9);
 assert.equal(third.has_next,false);
 assert.equal(new Set([...first.cases,...second.cases,...third.cases].map(x=>x.request_id)).size,49);
});
test("Lectores, gestores y solicitudes inválidas nunca obtienen distribución global",async()=>{
 const f=fixture();
 for(const role of ["reader","manager"]){
  assert.equal(roleAllows(role,"/v2/operator/api/routing","GET"),false);
  assert.equal((await operatorRoutingOverview(f.env,{account_id:role,role},req())).status,403);
 }
 assert.equal(roleAllows("owner","/v2/operator/api/routing","GET"),true);
 assert.equal(roleAllows("owner","/v2/operator/api/routing","POST"),false);
 assert.equal((await operatorRoutingOverview({...f.env,ENVIRONMENT:"production"},f.actor,req())).status,403);
 for(const bad of ["?area=ingenieria","?scope=autoassign","?page=0",
  "?page=1000","?page=-1","?area=juridica&area=contaduria","?secret=test"]){
  assert.equal((await operatorRoutingOverview(f.env,f.actor,req(bad))).status,400,bad);
 }
});
test("Interfaz compacta exhibe distribución y exige confirmación al asignar gestor",async()=>{
 const html=await operatorPageResponse().text();
 for(const part of ['id="operator-routing"','id="routing-area"','id="routing-list"',
  'id="routing-scope"','id="routing-prev"','id="routing-next"',
  "Sin gestor responsable","No hemos comprobado aquí su especialidad o disponibilidad."]){
  assert.ok(html.includes(part),part);
 }
 assert.ok(html.includes("max-height:450px"));
});
