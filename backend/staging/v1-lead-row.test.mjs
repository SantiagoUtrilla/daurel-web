import test from "node:test";
import assert from "node:assert/strict";
import {LEGACY_LEAD_COLUMNS,planLegacyLeadMapping} from "./v1-lead-row.js";

function lead(overrides={}){
 // 29 campos de la estructura REAL de V1, pero con valores 100% ficticios.
 return {
  id:42,request_id:"DAU-20261107-5024",persona:"particular",
  name:"Cliente Ficticio",whatsapp:"5500000000",whatsapp_e164:"525500000000",
  email:"cliente@example.invalid",location:"Municipio de Pruebas",
  situation:"Tengo un asunto laboral totalmente ficticio para ensayar el sistema",
  key_answer:"No",category_front:"laboral",category_internal:"laboral",
  urgency:"soon",priority:"normal",routing_queue:"juridico",
  status:"contacted",follow_up_status:"pending",follow_up_count:2,
  privacy_consent:1,privacy_consent_at:"2026-11-07 12:03:04",
  needs_human_review:1,professional_assigned:"Profesional de Pruebas",
  deadline_verified:0,deadline_basis:null,deadline_notes:null,
  documents_status:"pending",documents_requested:"Lista de documentos ficticios",
  created_at:"2026-11-07 12:03:04",updated_at:"2026-11-10 17:05:06",
  ...overrides,
 };
}
test("El plan reconoce exactamente las 29 columnas fotografiadas en leads",()=>{
 assert.equal(LEGACY_LEAD_COLUMNS.length,29);
 const sample=lead();
 assert.deepEqual(Object.keys(sample),[...LEGACY_LEAD_COLUMNS]);
 const mapped=planLegacyLeadMapping(sample);
 assert.equal(mapped.ok,true);
 assert.equal(mapped.mode,"planning_only");
 assert.equal(mapped.auto_import_allowed,false);
 assert.equal(mapped.source.pk,"42");
 assert.equal(mapped.source.public_folio,"DAU-20261107-5024");
 assert.deepEqual(mapped.legacy_map,{
  legacy_source:"daurel_v1_leads",legacy_request_id:"42",
 });
 assert.equal(mapped.request.public_folio,"DAU-20261107-5024");
 assert.equal(mapped.request.status,"contacted");
 assert.equal(mapped.request.priority,"normal");
 assert.equal(mapped.request.opened_at,sample.created_at);
 assert.equal(mapped.request.updated_at,sample.updated_at);
 assert.equal(mapped.request.intake_channel,"legacy_v1_web");
});
test("WhatsApp y email siguen sin verificar y no vinculan casos ni cuentas",()=>{
 const x=planLegacyLeadMapping(lead());
 assert.equal(x.party.provisional_separate_per_lead,true);
 assert.equal(x.party.contacts.length,2);
 assert.equal(x.party.contacts[0].verified_at,null);
 assert.equal(x.party.contacts[1].verified_at,null);
 assert.equal(x.account_access.automatic,false);
 assert.equal(x.account_access.requires_identity_and_explicit_grant,true);
 assert.equal(x.party.contacts[1].normalized_value,"cliente@example.invalid");
});
test("No inventar versión del aviso ni usar created_at como consentimiento",()=>{
 const x=planLegacyLeadMapping(lead({privacy_consent_at:null}));
 assert.equal(x.ok,true);
 assert.equal(x.consent.legacy_consent,1);
 assert.equal(x.consent.legacy_recorded_at,null);
 assert.equal(x.consent.v2_document_version,null);
 assert.equal(x.consent.may_create_v2_consent,false);
 assert.ok(x.warnings.includes("consentimiento_sin_fecha"));
 assert.ok(x.warnings.includes("version_aviso_privacidad_no_acreditada"));
});
test("Conserva metadatos jurídicos sin inventar eventos o plazos",()=>{
 const sample=lead({
  deadline_verified:1,
  deadline_basis:"Fundamento ficticio",
  deadline_notes:"Plazo hipotético pendiente de revisión",
  professional_assigned:"Profesional X",
  follow_up_count:2,
 });
 const x=planLegacyLeadMapping(sample);
 assert.equal(x.untransferred_legacy.deadline_basis,"Fundamento ficticio");
 assert.equal(x.untransferred_legacy.deadline_verified,1);
 assert.equal(x.untransferred_legacy.deadline_notes,"Plazo hipotético pendiente de revisión");
 assert.equal(x.untransferred_legacy.professional_assigned,"Profesional X");
 assert.equal(x.untransferred_legacy.follow_up_count,2);
 assert.ok(x.warnings.includes("plazos_requieren_revision_humana"));
 assert.ok(!Object.hasOwn(x,"events"));
 assert.ok(!Object.hasOwn(x,"followup_tasks"));
});
test("Estados no reconocidos se señalan para revisión, no se sustituyen por 'new'",()=>{
 const x=planLegacyLeadMapping(lead({status:"legacy_unknown",priority:"urgent"}));
 assert.equal(x.ok,true);
 assert.equal(x.request.status,null);
 assert.equal(x.request.priority,null);
 assert.ok(x.warnings.includes("estado_sin_equivalencia"));
 assert.ok(x.warnings.includes("prioridad_sin_equivalencia"));
});
test("Dos leads con mismo WhatsApp siguen siendo dos fuentes separadas",()=>{
 const a=planLegacyLeadMapping(lead({id:42,request_id:"DAU-20261107-5024"}));
 const b=planLegacyLeadMapping(lead({id:43,request_id:"DAU-20261107-5025"}));
 assert.equal(a.party.contacts[0].normalized_value,b.party.contacts[0].normalized_value);
 assert.notEqual(a.legacy_map.legacy_request_id,b.legacy_map.legacy_request_id);
 assert.notEqual(a.request.public_folio,b.request.public_folio);
 assert.equal(a.account_access.automatic,false);
 assert.equal(b.account_access.automatic,false);
});
test("Rechaza filas incompletas y evita confundir ID con folio",()=>{
 assert.equal(planLegacyLeadMapping(null).ok,false);
 assert.equal(planLegacyLeadMapping({id:1}).ok,false);
 assert.equal(planLegacyLeadMapping(lead({id:0})).ok,false);
 assert.equal(planLegacyLeadMapping(lead({request_id:""})).ok,false);
 assert.equal(planLegacyLeadMapping(lead({follow_up_count:-1})).ok,false);
 const unfamiliar=planLegacyLeadMapping(lead({request_id:"FOLIO-VIEJO-123"}));
 assert.equal(unfamiliar.ok,true);
 assert.ok(unfamiliar.warnings.includes("formato_folio_revisar"));
 assert.equal(unfamiliar.request.public_folio,"FOLIO-VIEJO-123");
});
test("La transformación es pura y no utiliza cuentas ni base de datos",()=>{
 const row=Object.freeze(lead());
 const snapshot=JSON.stringify(row);
 const mapped=planLegacyLeadMapping(row);
 assert.equal(mapped.ok,true);
 assert.equal(JSON.stringify(row),snapshot);
 assert.ok(!Object.hasOwn(mapped,"db"));
 assert.ok(!Object.hasOwn(mapped,"query"));
});
