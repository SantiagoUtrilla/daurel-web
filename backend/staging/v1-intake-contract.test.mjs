import test from "node:test";
import assert from "node:assert/strict";
import {normalizeV1Intake,V1_CATEGORIES,V1_FORM_FIELDS} from "./v1-intake-contract.js";

// Sólo datos totalmente inventados: sin solicitudes, personas o tokens reales.
function fixture(overrides={}){
 return {
  persona:"particular",situation:"Solicito orientación laboral ficticia para validar el flujo",
  key_answer:"No",category_front:"laboral",category_internal:"laboral",
  urgency:"48h",priority:"high",name:"Persona de Prueba",
  whatsapp:"5500000000",location:"Municipio Ficticio",
  privacy_consent:true,turnstile_token:"token_sintetico_no_verificado",
  ...overrides,
 };
}
test("El adaptador coincide con las 12 claves del formulario V1 y preserva datos y prioridad",()=>{
 assert.equal(V1_FORM_FIELDS.length,12);
 const result=normalizeV1Intake(fixture());
 assert.equal(result.ok,true);
 assert.equal(result.party.kind,"person");
 assert.equal(result.party.contact_type,"whatsapp");
 assert.equal(result.party.display_name,"Persona de Prueba");
 assert.equal(result.party.contact_value,"5500000000");
 assert.equal(result.request.priority,"high");
 assert.equal(result.request.source_category,"laboral");
 assert.equal(result.request.source_urgency,"48h");
 assert.equal(result.request.intake_channel,"web");
 assert.equal(result.request.status,"new");
 assert.equal(result.consent.document_version,null);
 assert.equal(result.source.requires_legacy_request_id,true);
 assert.equal(result.source.preserve_existing_public_folio,true);
 assert.equal(result.account_access.auto_link,false);
 assert.ok(!JSON.stringify(result).includes("token_sintetico_no_verificado"));
});
test("Todas las categorías V1 quedan preservadas sin inventar servicios",()=>{
 assert.deepEqual(V1_CATEGORIES,["laboral","accidente","deuda","familiar","marca","citatorio","contrato","general"]);
 for(const cat of V1_CATEGORIES){
  const actual=normalizeV1Intake(fixture({category_front:cat,category_internal:cat}));
  assert.equal(actual.ok,true,cat);
  assert.equal(actual.request.source_category,cat);
  assert.ok(!Object.hasOwn(actual.request,"service_id"));
 }
});
test("Las cuatro urgencias son las verdaderas opciones V1 y la prioridad coincide",()=>{
 for(const urgency of ["48h","soon","no","unknown"]){
  const priority=urgency==="48h"?"high":"normal";
  const result=normalizeV1Intake(fixture({urgency,priority}));
  assert.equal(result.ok,true,urgency);
  assert.equal(result.request.source_urgency,urgency);
 }
 for(const urgency of ["7d","30d","next_week"]){
  assert.equal(normalizeV1Intake(fixture({urgency,priority:"normal"})).ok,false);
 }
 assert.equal(normalizeV1Intake(fixture({urgency:"48h",priority:"normal"})).ok,false);
});
test("La empresa se registra como organización, sin crear credenciales ni vincular casos",()=>{
 const result=normalizeV1Intake(fixture({persona:"empresa"}));
 assert.equal(result.ok,true);
 assert.equal(result.party.kind,"organization");
 assert.equal(result.account_access.requires_manual_authorization,true);
 assert.ok(!Object.hasOwn(result,"account"));
});
test("Rechaza campos extra, consentimiento ausente y discrepancias de clasificación",()=>{
 assert.equal(normalizeV1Intake(fixture({email:"inventado@ejemplo.invalid"})).ok,false);
 assert.equal(normalizeV1Intake(fixture({privacy_consent:false})).ok,false);
 assert.equal(normalizeV1Intake(fixture({turnstile_token:""})).ok,false);
 assert.equal(normalizeV1Intake(fixture({category_internal:"general"})).ok,false);
 assert.equal(normalizeV1Intake(fixture({situation:"muy corta"})).ok,false);
 assert.equal(normalizeV1Intake(fixture({whatsapp:"555"})).ok,false);
 assert.equal(normalizeV1Intake(fixture({name:""})).ok,false);
 assert.equal(normalizeV1Intake(fixture({persona:"impostor"})).ok,false);
});
test("El adaptador es puro: no muta el payload ni escribe en D1",()=>{
 const value=fixture();
 const original=JSON.stringify(value);
 assert.equal(normalizeV1Intake(Object.freeze(value)).ok,true);
 assert.equal(JSON.stringify(value),original);
});
