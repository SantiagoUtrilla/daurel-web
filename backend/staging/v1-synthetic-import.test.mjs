// Ensayo de migración V1 -> V2 usando exclusivamente tres filas ficticias en
// SQLite en memoria. No solicita datos a Cloudflare ni lee registros privados.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {rehearseLegacyImport} from "./v1-synthetic-import.js";

const MIGRATIONS=["0001_v2_core.sql","0002_optional_accounts.sql",
 "0003_case_invitations.sql","0004_followup_tasks.sql",
 "0005_legacy_lead_details.sql"];
function prepare(sqlite,sql,args=[]){
 return {
  bind:(...next)=>prepare(sqlite,sql,next),
  run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
  first:async()=>sqlite.prepare(sql).get(...args)||null,
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
 };
}
function database(withDetails=true){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of withDetails?MIGRATIONS:MIGRATIONS.slice(0,-1)){
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 }
 const db={
  prepare:sql=>prepare(sqlite,sql),
  batch:async stmts=>{
   sqlite.exec("BEGIN");
   try{
    const out=[];
    for(const s of stmts)out.push(await s.run());
    sqlite.exec("COMMIT");
    return out;
   }catch(error){sqlite.exec("ROLLBACK");throw error}
  },
 };
 return {sqlite,db};
}
function fixture(id=1,overrides={}){
 return {
  id,request_id:"DAU-20260101-"+String(9000+id),
  persona:"particular",name:"FICTICIO - Cliente de ensayo",
  whatsapp:"5500000000",whatsapp_e164:"525500000000",
  email:"ficticio@example.invalid",location:"Municipio inventado",
  situation:"Asesoría simulada que no corresponde a persona real",
  key_answer:"Respuesta hipotética",category_front:"laboral",
  category_internal:"laboral",urgency:"48h",priority:"normal",
  routing_queue:"juridico",status:"new",
  follow_up_status:"pending",follow_up_count:0,
  privacy_consent:1,privacy_consent_at:"2026-01-01 10:15:00",
  needs_human_review:0,professional_assigned:null,
  deadline_verified:0,deadline_basis:null,deadline_notes:null,
  documents_status:"pending",documents_requested:null,
  created_at:"2026-01-01 10:15:00",
  updated_at:"2026-01-03 15:00:00",
  ...overrides,
 };
}
const count=(sqlite,table)=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;

test("Tres expedientes ficticios: conserva folios, estados, fechas y urgencia 48h con prioridad normal",async()=>{
 const {db,sqlite}=database();
 const rows=[
  fixture(1,{status:"new",urgency:"soon",follow_up_count:0}),
  fixture(2,{status:"contacted",urgency:"48h",priority:"normal",follow_up_count:2,
   deadline_verified:1,deadline_basis:"Fundamento hipotético",
   deadline_notes:"Sin fecha legal calculada"}),
  fixture(3,{status:"new",urgency:"no",follow_up_count:1}),
 ];
 for(const row of rows){
  const r=await rehearseLegacyImport(db,row);
  assert.equal(r.ok,true);
  assert.equal(r.imported,true);
  assert.equal(r.public_folio,row.request_id);
 }
 assert.equal(count(sqlite,"parties"),3);
 assert.equal(count(sqlite,"service_requests"),3);
 assert.equal(count(sqlite,"legacy_request_map"),3);
 assert.equal(count(sqlite,"legacy_lead_details"),3);
 assert.equal(count(sqlite,"request_participants"),3);
 assert.equal(count(sqlite,"party_contacts"),6);
 assert.equal(count(sqlite,"request_events"),0); // No inventar actuaciones históricas.
 assert.equal(count(sqlite,"consents"),0); // Versión del aviso aún desconocida.
 assert.equal(count(sqlite,"accounts"),0);
 assert.equal(count(sqlite,"account_party_access"),0);
 assert.equal(count(sqlite,"account_request_access"),0);
 const saved=sqlite.prepare([
  "SELECT sr.public_folio,sr.status,sr.priority,sr.opened_at,sr.updated_at,",
  "ld.urgency,ld.follow_up_count,ld.deadline_notes,ld.privacy_consent_at",
  "FROM service_requests sr JOIN legacy_lead_details ld ON ld.request_id=sr.request_id",
  "ORDER BY ld.source_record_id",
 ].join(" ")).all();
 assert.deepEqual(saved.map(s=>s.public_folio),rows.map(r=>r.request_id));
 assert.deepEqual(saved.map(s=>s.status),["new","contacted","new"]);
 assert.equal(saved[1].priority,"normal");
 assert.equal(saved[1].urgency,"48h");
 assert.equal(saved[1].follow_up_count,2);
 assert.equal(saved[1].deadline_notes,"Sin fecha legal calculada");
 assert.equal(saved[1].privacy_consent_at,rows[1].privacy_consent_at);
 assert.equal(saved[1].opened_at,rows[1].created_at);
 assert.equal(saved[1].updated_at,rows[1].updated_at);
});

test("Repetir la importación exacta no genera duplicados ni cambia la fecha original",async()=>{
 const {db,sqlite}=database(),row=fixture(11);
 const one=await rehearseLegacyImport(db,row);
 const two=await rehearseLegacyImport(db,{...row});
 assert.equal(one.imported,true);
 assert.equal(two.replayed,true);
 assert.equal(two.imported,false);
 assert.equal(count(sqlite,"service_requests"),1);
 assert.equal(count(sqlite,"parties"),1);
 assert.equal(count(sqlite,"legacy_lead_details"),1);
 const value=sqlite.prepare("SELECT imported_at FROM legacy_request_map").get();
 assert.ok(value.imported_at);
});

test("Dos registros comparten WhatsApp y correo, pero nunca comparten cuenta ni party",async()=>{
 const {db,sqlite}=database();
 await rehearseLegacyImport(db,fixture(1));
 await rehearseLegacyImport(db,fixture(2));
 const joins=sqlite.prepare([
  "SELECT sr.requester_party_id,pc.normalized_value",
  "FROM service_requests sr JOIN party_contacts pc",
  "ON pc.party_id=sr.requester_party_id AND pc.contact_type='whatsapp'",
  "ORDER BY sr.public_folio",
 ].join(" ")).all();
 assert.equal(joins.length,2);
 assert.equal(joins[0].normalized_value,joins[1].normalized_value);
 assert.notEqual(joins[0].requester_party_id,joins[1].requester_party_id);
 assert.equal(count(sqlite,"account_request_access"),0);
});

test("Cambiar un registro de origen después de importar genera conflicto, no sobrescribe",async()=>{
 const {db,sqlite}=database(),a=fixture(5);
 assert.equal((await rehearseLegacyImport(db,a)).ok,true);
 const changed=await rehearseLegacyImport(db,fixture(5,{situation:"Descripción simulada diferente"}));
 assert.equal(changed.ok,false);
 assert.match(changed.reason,/cambió/);
 const kept=sqlite.prepare("SELECT summary FROM service_requests").get().summary;
 assert.equal(kept,a.situation);
 assert.equal(count(sqlite,"service_requests"),1);
});

test("Duplicar un folio entre dos IDs históricos revierte todas las escrituras",async()=>{
 const {db,sqlite}=database();
 assert.equal((await rehearseLegacyImport(db,fixture(6))).ok,true);
 const duplicate=fixture(7,{request_id:"DAU-20260101-9006"});
 const attempt=await rehearseLegacyImport(db,duplicate);
 assert.equal(attempt.ok,false);
 assert.match(attempt.reason,/conflicto/i);
 assert.equal(count(sqlite,"service_requests"),1);
 assert.equal(count(sqlite,"parties"),1);
 assert.equal(count(sqlite,"party_contacts"),2);
 assert.equal(count(sqlite,"legacy_request_map"),1);
});

test("Rechazar origen real o columnas nuevas evita importaciones no autorizadas",async()=>{
 const {db,sqlite}=database();
 for(const row of [
  fixture(12,{name:"Nombre Real"}),
  fixture(12,{email:"real@example.com"}),
  fixture(12,{whatsapp:"5512345678"}),
  fixture(12,{status:"not_a_valid_status"}),
  fixture(12,{priority:"urgent"}),
  fixture(12,{privacy_consent:1,privacy_consent_at:null}),
  fixture(12,{unexpected_column:"se ignoraría"}),
 ]){
  const result=await rehearseLegacyImport(db,row);
  assert.equal(result.ok,false,JSON.stringify(row));
 }
 assert.equal(count(sqlite,"parties"),0);
});

test("Sin migración 0005 no quedan filas parciales después del fallo",async()=>{
 const {db,sqlite}=database(false);
 await assert.rejects(()=>rehearseLegacyImport(db,fixture(15)),/legacy_lead_details/);
 assert.equal(count(sqlite,"parties"),0);
 assert.equal(count(sqlite,"service_requests"),0);
 assert.equal(count(sqlite,"legacy_request_map"),0);
});

test("No hay endpoint de importación: la operación solo se ejecuta desde los tests",async()=>{
 const {db,sqlite}=database();
 const r=await rehearseLegacyImport(db,fixture(21));
 assert.equal(r.ok,true);
 assert.ok(!JSON.stringify(r).includes("5500000000"));
 assert.ok(!JSON.stringify(r).includes("ficticio@example.invalid"));
 assert.ok(!JSON.stringify(r).includes("Asesoría simulada"));
 assert.equal(count(sqlite,"integration_events"),0);
});
