// DAUREL V2: identificador y checklist documental SOLO para identidades ficticias.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {listProfessionalIdentities,saveProfessionalIdentity} from "./operator-professional-identity.js";
import {roleAllows} from "./operator-auth.js";
import {operatorPageResponse} from "./operator-page.js";

const BASE="https://staging.invalid",OWNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
 MANAGER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",READER="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const files=[
 "0001_v2_core.sql","0002_optional_accounts.sql","0006_operator_identity.sql",
 "0007_operator_approvals.sql","0008_professional_profiles.sql","0009_professional_identity.sql"
];
function fixture(withMigration=true){
 const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of files.slice(0,withMigration?6:5))
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 const q=sql=>{const wrap=(args=[])=>({
  bind:(...n)=>wrap(n),
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  first:async()=>sqlite.prepare(sql).get(...args)||null,
  run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
 });return wrap();};
 const DB={prepare:q,batch:async steps=>{
  sqlite.exec("BEGIN");try{
   const vals=[];for(const st of steps)vals.push(await st.run());
   sqlite.exec("COMMIT");return vals;
  }catch(error){sqlite.exec("ROLLBACK");throw error}
 }};
 const env={DB,ENVIRONMENT:"staging"};
 const actor={account_id:OWNER,role:"owner"};
 for(const [id,role] of [[OWNER,"owner"],[MANAGER,"manager"],[READER,"reader"]]){
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES (?)").run(id);
  sqlite.prepare("INSERT INTO operator_memberships(account_id,role) VALUES (?,?)").run(id,role);
  if(role!=="owner"){
   sqlite.prepare([
    "INSERT INTO operator_approved_emails(email_normalized,account_id,approved_by_account_id)",
    "VALUES (?,?,?)",
   ].join(" ")).run(role+"@example.invalid",id,OWNER);
  }
 }
 return {sqlite,env,actor};
}
function req(payload={account_id:MANAGER,full_name:"María de los Ángeles Pérez López"},opts={}){
 return new Request(BASE+"/v2/operator/api/professionals/identity/save",{
  method:"POST",headers:{"Origin":opts.origin||BASE,"Content-Type":"application/json"},
  body:JSON.stringify(payload)
 });
}
const n=(db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;

test("Sin 0009 no modifica datos, y el módulo informa la migración pendiente",async()=>{
 const f=fixture(false);
 assert.equal((await listProfessionalIdentities(f.env,f.actor)).status,503);
 assert.equal((await saveProfessionalIdentity(req(),f.env,f.actor)).status,503);
});
test("Propietario guarda el nombre de prueba, crea cinco requisitos pendientes y conserva los permisos",async()=>{
 const f=fixture();
 const first=await (await listProfessionalIdentities(f.env,f.actor)).json();
 assert.equal(first.identities.length,2);
 assert.ok(first.identities.every(x=>x.full_name===""));
 assert.equal(first.automatic_assignment_enabled,false);
 const added=await saveProfessionalIdentity(req(),f.env,f.actor);
 assert.equal(added.status,200,JSON.stringify(await added.clone().json()));
 const after=await (await listProfessionalIdentities(f.env,f.actor)).json();
 const m=after.identities.find(x=>x.account_id===MANAGER);
 const reader=after.identities.find(x=>x.account_id===READER);
 assert.equal(m.full_name,"María de los Ángeles Pérez López");
 assert.equal(reader.full_name,"");
 assert.deepEqual(Object.values(m.onboarding),Array(5).fill("not_collected"));
 assert.equal(m.credentials_verified,false);
 assert.equal(n(f.sqlite,"operator_professional_requirements"),5);
 assert.equal(n(f.sqlite,"operator_case_assignments"),0);
 assert.equal(n(f.sqlite,"operator_access_audit"),1);
 const repeat=await (await saveProfessionalIdentity(req(),f.env,f.actor)).json();
 assert.equal(repeat.replayed,true);
 assert.equal(n(f.sqlite,"operator_access_audit"),1);
 const change=await saveProfessionalIdentity(req({account_id:MANAGER,full_name:"María Pérez López"}),f.env,f.actor);
 assert.equal(change.status,200);
 assert.equal(n(f.sqlite,"operator_professional_requirements"),5);
 assert.equal(n(f.sqlite,"operator_access_audit"),2);
});
test("Solo la persona propietaria puede consultar y guardar nombres profesionales",async()=>{
 const f=fixture();
 for(const role of ["reader","manager"]){
  assert.equal((await listProfessionalIdentities(f.env,{role,account_id:MANAGER})).status,403);
  assert.equal((await saveProfessionalIdentity(req(),f.env,{role,account_id:MANAGER})).status,403);
  assert.equal(roleAllows(role,"/v2/operator/api/professionals/identity/list","GET"),false);
  assert.equal(roleAllows(role,"/v2/operator/api/professionals/identity/save","POST"),false);
 }
 assert.equal(roleAllows("owner","/v2/operator/api/professionals/identity/list","GET"),true);
 assert.equal(roleAllows("owner","/v2/operator/api/professionals/identity/save","POST"),true);
 assert.equal(roleAllows("owner","/v2/operator/api/professionals/identity/save","GET"),false);
 assert.equal((await listProfessionalIdentities({...f.env,ENVIRONMENT:"production"},f.actor)).status,403);
 assert.equal((await saveProfessionalIdentity(req(),{...f.env,ENVIRONMENT:"production"},f.actor)).status,403);
});
test("No admite nombres maliciosos, documentos, INE, cédula ni aceptación de contrato por esta ruta",async()=>{
 const f=fixture();
 const good={account_id:MANAGER,full_name:"Nombre de Prueba"};
 const bad=[
  {...good,full_name:"<script>alert(1)</script>"},
  {...good,full_name:"Nombre Ejemplo 123"},
  {...good,full_name:"X"},
  {...good,full_name:"A".repeat(121)},
  {...good,full_name:"\nEncabezado\n"},
  {...good,full_name:"🪪 Fotografía"},
  {...good,full_name:123},
  {...good,ine:"imagen.jpg"},
  {...good,cedula:"1234567"},
  {...good,terms_accepted:true},
  {...good,account_id:OWNER},
  {...good,account_id:"invalid"},
 ];
 for(const body of bad){
  assert.equal((await saveProfessionalIdentity(req(body),f.env,f.actor)).status,400,JSON.stringify(body));
 }
 assert.equal(n(f.sqlite,"operator_professional_identities"),0);
 assert.equal(n(f.sqlite,"operator_professional_requirements"),0);
 assert.equal((await saveProfessionalIdentity(req(good,{origin:"https://intruso.invalid"}),f.env,f.actor)).status,403);
});
test("La vista muestra nombre junto al correo, guarda desde panel y no permite adjuntos sensibles",async()=>{
 const html=await operatorPageResponse().text();
 for(const token of [
  "Nombre sin registrar","Nombre completo (solo ficticio en pruebas)",
  "/v2/operator/api/professionals/identity/list",
  "/v2/operator/api/professionals/identity/save",
  "Requisitos de incorporación","No subas INE, cédulas, contratos ni firmas",
 ])assert.ok(html.includes(token),token);
 assert.ok(!html.includes('type="file"'));
});
