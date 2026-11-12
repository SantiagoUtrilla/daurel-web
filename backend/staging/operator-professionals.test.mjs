// DAUREL V2 · Perfiles declarados del equipo: solo owner, sin auto-asignación.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {listProfessionalProfiles,saveProfessionalProfile} from "./operator-professionals.js";
import {roleAllows} from "./operator-auth.js";
import {operatorPageResponse} from "./operator-page.js";

const ORIGIN="https://staging.invalid",PATH="/v2/operator/api/professionals/save";
const OWNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const READER="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNKNOWN="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const sqls=[
 "0001_v2_core.sql","0002_optional_accounts.sql","0006_operator_identity.sql",
 "0007_operator_approvals.sql","0008_professional_profiles.sql"
];
function fixture(withProfile=true){
 const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
 for(const file of sqls.slice(0,withProfile?5:4))
  sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 const prep=sql=>{const bound=(args=[])=>({
  bind:(...next)=>bound(next),
  first:async()=>sqlite.prepare(sql).get(...args)||null,
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  run:async()=>({meta:sqlite.prepare(sql).run(...args)}),
 });return bound();};
 const DB={prepare:prep,batch:async statements=>{
  sqlite.exec("BEGIN");
  try{const out=[];for(const statement of statements)out.push(await statement.run());
   sqlite.exec("COMMIT");return out;
  }catch(e){sqlite.exec("ROLLBACK");throw e}
 }};
 const env={DB,ENVIRONMENT:"staging"};
 const owner={account_id:OWNER,role:"owner"};
 for(const [id,role] of [[OWNER,"owner"],[MANAGER,"manager"],[READER,"reader"]]){
  sqlite.prepare("INSERT INTO accounts(account_id) VALUES(?)").run(id);
  sqlite.prepare("INSERT INTO operator_memberships(account_id,role) VALUES(?,?)").run(id,role);
  if(role==="owner"){
   sqlite.prepare("INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at) VALUES ('owner-mail',?,'daurelcontact@gmail.com',CURRENT_TIMESTAMP)").run(id);
  }else{
   const email=role+"@example.invalid";
   sqlite.prepare("INSERT INTO operator_approved_emails(email_normalized,account_id,approved_by_account_id) VALUES(?,?,?)")
    .run(email,id,OWNER);
   if(role==="manager")
    sqlite.prepare("INSERT INTO account_emails(email_id,account_id,email_normalized,verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP)")
     .run("mail-"+role,id,email);
  }
 }
 return {sqlite,DB,env,owner};
}
function req(data={account_id:MANAGER,availability:"available",capacity_limit:3,
 specialties:["juridica_laboral","juridica_civil"]},options={}){
 return new Request(ORIGIN+PATH,{
  method:"POST",
  headers:{Origin:options.origin||ORIGIN,"Content-Type":"application/json"},
  body:JSON.stringify(data)
 });
}
const count=(db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;

test("Perfiles quedan desactivados hasta instalar la migración 0008 en staging",async()=>{
 const {env,owner}=fixture(false);
 assert.equal((await listProfessionalProfiles(env,owner)).status,503);
 assert.equal((await saveProfessionalProfile(req(),env,owner)).status,503);
});
test("Propietario puede declarar capacidades sin conceder ningún permiso ni verificar credenciales",async()=>{
 const f=fixture();
 let initial=await (await listProfessionalProfiles(f.env,f.owner)).json();
 assert.equal(initial.profiles.length,2);
 assert.ok(initial.profiles.every(p=>p.configured===false));
 assert.ok(initial.profiles.every(p=>p.credential_verified===false));
 assert.ok(initial.profiles.find(p=>p.account_id===READER).email_verified===false);
 const saved=await saveProfessionalProfile(req(),f.env,f.owner);
 assert.equal(saved.status,200,JSON.stringify(await saved.clone().json()));
 assert.equal((await saved.json()).credential_verified,false);
 assert.equal(count(f.sqlite,"operator_case_assignments"),0);
 const next=await (await listProfessionalProfiles(f.env,f.owner)).json();
 assert.equal(next.automatic_assignment_enabled,false);
 assert.equal(next.profiles.find(p=>p.account_id===MANAGER).availability,"available");
 assert.deepEqual(next.profiles.find(p=>p.account_id===MANAGER).specialties,
  ["juridica_civil","juridica_laboral"]);
 assert.equal(count(f.sqlite,"operator_professional_capabilities"),2);
 assert.equal(count(f.sqlite,"operator_access_audit"),1);
 const repeat=await (await saveProfessionalProfile(req(),f.env,f.owner)).json();
 assert.equal(repeat.replayed,true);
 assert.equal(count(f.sqlite,"operator_access_audit"),1);
});
test("Editar especialidades reemplaza el conjunto completo y permite un perfil sin capacidades",async()=>{
 const f=fixture();
 assert.equal((await saveProfessionalProfile(req(),f.env,f.owner)).status,200);
 const update=req({account_id:MANAGER,availability:"limited",capacity_limit:1,specialties:["contaduria"]});
 assert.equal((await saveProfessionalProfile(update,f.env,f.owner)).status,200);
 let data=await (await listProfessionalProfiles(f.env,f.owner)).json();
 assert.deepEqual(data.profiles.find(p=>p.account_id===MANAGER).specialties,["contaduria"]);
 assert.equal(data.profiles.find(p=>p.account_id===MANAGER).capacity_limit,1);
 assert.equal((await saveProfessionalProfile(req({account_id:READER,availability:"unavailable",
  capacity_limit:5,specialties:[]}),f.env,f.owner)).status,200);
 data=await (await listProfessionalProfiles(f.env,f.owner)).json();
 assert.equal(data.profiles.find(p=>p.account_id===READER).configured,true);
 assert.deepEqual(data.profiles.find(p=>p.account_id===READER).specialties,[]);
 assert.equal(count(f.sqlite,"operator_case_assignments"),0);
});
test("Rechaza datos ambiguos o extralimitados, sin modificar ninguna tabla",async()=>{
 const f=fixture();
 const base={account_id:MANAGER,availability:"available",capacity_limit:3,
  specialties:["juridica_laboral"]};
 const bad=[
  {...base,availability:"auto"},
  {...base,capacity_limit:0},
  {...base,capacity_limit:21},
  {...base,capacity_limit:"2"},
  {...base,account_id:OWNER},
  {...base,account_id:UNKNOWN},
  {...base,specialties:["juridica_laboral","juridica_laboral"]},
  {...base,specialties:["medicina"]},
  {...base,specialties:[12]},
  {...base,validated:true},
 ];
 for(const input of bad){
  const res=await saveProfessionalProfile(req(input),f.env,f.owner);
  assert.ok([400,404].includes(res.status),JSON.stringify(input));
 }
 assert.equal(count(f.sqlite,"operator_professional_profiles"),0);
 assert.equal(count(f.sqlite,"operator_access_audit"),0);
 assert.equal((await saveProfessionalProfile(req(base,{origin:"https://other.invalid"}),f.env,f.owner)).status,403);
});
test("Gestores, lectores y entorno real no consultan ni modifican el directorio",async()=>{
 const f=fixture();
 for(const role of ["reader","manager"]){
  assert.equal(roleAllows(role,"/v2/operator/api/professionals/list","GET"),false);
  assert.equal(roleAllows(role,"/v2/operator/api/professionals/save","POST"),false);
  assert.equal((await listProfessionalProfiles(f.env,{role,account_id:MANAGER})).status,403);
  assert.equal((await saveProfessionalProfile(req(),f.env,{role,account_id:MANAGER})).status,403);
 }
 assert.equal(roleAllows("owner","/v2/operator/api/professionals/list","GET"),true);
 assert.equal(roleAllows("owner","/v2/operator/api/professionals/save","POST"),true);
 assert.equal(roleAllows("owner","/v2/operator/api/professionals/save","GET"),false);
 assert.equal((await listProfessionalProfiles({...f.env,ENVIRONMENT:"production"},f.owner)).status,403);
});
test("Interfaz declara especialidades y disponibilidad mediante ficha plegable",async()=>{
 const html=await operatorPageResponse().text();
 for(const term of ["profile-config","Especialidades y disponibilidad",
  "Disponibilidad declarada","Capacidad de asuntos de prueba",
  "/v2/operator/api/professionals/list","/v2/operator/api/professionals/save",
  "No comprueba cédulas, títulos ni habilita asignación automática"]){
  assert.ok(html.includes(term),term);
 }
});
