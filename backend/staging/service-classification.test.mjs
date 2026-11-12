// DAUREL V2 · clasificación estricta en bandeja, sin modificar casos.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {classifySyntheticRequest,countSyntheticAreas} from "./service-classification.js";
import {operatorQueue} from "./operator-api.js";

const EXPECT=[
 ["Solicitud ficticia: consulta laboral","juridica","Laboral"],
 ["Solicitud ficticia: asunto civil","juridica","Civil"],
 ["Solicitud ficticia: registro de marca","juridica","Propiedad intelectual"],
 ["Solicitud ficticia: orientación contable","contaduria","Orientación contable"],
 ["Solicitud ficticia: orientación general","por_clasificar","Orientación general"],
];
test("Clasifica servicios exactos y no asigna un abogado, contador o ingeniero por palabras libres",()=>{
 for(const [summary,area,specialty] of EXPECT){
  const result=classifySyntheticRequest(summary);
  assert.equal(result.area,area);
  assert.equal(result.specialty,specialty);
  assert.equal(result.classification,"catalog");
 }
 for(const s of ["Consulta fiscal urgente","ingeniería estructural",
  "Solicitud ficticia: CONSULTA LABORAL","demanda por contrato",
  "Solicitud ficticia: orientación contable adicional"]){
  const c=classifySyntheticRequest(s);
  assert.equal(c.area,"por_clasificar");
  assert.equal(c.classification,"requires_review");
 }
 assert.deepEqual(countSyntheticAreas(EXPECT.map(([summary])=>({summary}))),
  {juridica:3,contaduria:1,por_clasificar:1});
});

function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of ["0001_v2_core.sql","0002_optional_accounts.sql",
  "0003_case_invitations.sql","0006_operator_identity.sql","0007_operator_approvals.sql"])
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 const DB={
  prepare:(sql)=>{
   const make=(values=[])=>({
    bind:(...args)=>make(args),
    all:async()=>({results:sqlite.prepare(sql).all(...values)}),
    first:async()=>sqlite.prepare(sql).get(...values)||null,
    run:async()=>({meta:sqlite.prepare(sql).run(...values)}),
   });
   return make();
  },
 };
 sqlite.prepare("INSERT INTO channel_accounts(channel_account_id,provider,provider_account_id) VALUES ('daurel-v2-demo','staging','demo')").run();
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES ('owner')").run();
 sqlite.prepare("INSERT INTO accounts(account_id) VALUES ('reader')").run();
 for(let i=0;i<EXPECT.length+1;i++){
  const id="11111111-1111-4111-8111-"+String(i+1).padStart(12,"0");
  const party="party-"+i;
  sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?,'person')").run(party);
  sqlite.prepare("INSERT INTO external_identities(identity_id,party_id,channel_account_id,provider_user_id) VALUES (?,?,?,?)")
   .run("ident-"+i,party,"daurel-v2-demo","demo-client-"+i);
  const summary=i<EXPECT.length?EXPECT[i][0]:"Consulta de ingeniería que requiere revisar";
  sqlite.prepare("INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel) VALUES (?,?,?,?,'staging_demo')")
   .run(id,"DAU-TEST-"+i,party,summary);
  if(i===0||i===3)sqlite.prepare("INSERT INTO operator_case_assignments(account_id,request_id,assigned_by_account_id) VALUES ('reader',?,'owner')").run(id);
 }
 return {sqlite,env:{DB,ENVIRONMENT:"staging"}};
}
test("La bandeja del propietario clasifica solo registros sintéticos autorizados y cuenta solo los 100 visibles",async()=>{
 const f=fixture();
 const response=await operatorQueue(f.env,{account_id:"owner",role:"owner"});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.statistics.total,6);
 assert.equal(body.cases.length,6);
 assert.deepEqual(body.area_page_counts,{juridica:3,contaduria:1,por_clasificar:2});
 assert.equal(body.area_counts_scope,"current_page_only");
 assert.equal(body.cases.find(x=>x.summary.includes("ingeniería")).classification,"requires_review");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM operator_case_assignments").get().n,2);
 const table=f.sqlite.prepare("SELECT COUNT(*) AS n FROM request_events").get();
 assert.equal(table.n,0);
});

test("Lector solo recibe su subconjunto asignado, aun cuando existan más casos en el área",async()=>{
 const f=fixture();
 const response=await operatorQueue(f.env,{account_id:"reader",role:"reader"});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.statistics.total,2);
 assert.equal(result.cases.length,2);
 assert.deepEqual(result.area_page_counts,{juridica:1,contaduria:1,por_clasificar:0});
 assert.deepEqual(new Set(result.cases.map(c=>c.public_folio)),new Set(["DAU-TEST-0","DAU-TEST-3"]));
});

test("El panel muestra filtros profesionales sin afirmar asignación automática de colaboradores",async()=>{
 const page=(await (await import("./operator-page.js")).operatorPageResponse().text());
 assert.match(page,/id="area-filter"/);
 assert.match(page,/Jurídica/);
 assert.match(page,/Contaduría/);
 assert.match(page,/Por clasificar/);
 assert.match(page,/La clasificación automática no asigna profesionales/);
 assert.match(page,/Área: /);
});
