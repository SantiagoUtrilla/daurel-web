// DAUREL V2: ensayo transaccional de migración, NO IMPORTA CLIENTES REALES.
// Requiere un fixture inequívocamente ficticio, sin route pública ni secrets.
// La importación real necesitará revisión de privacidad, backups, auditoría,
// un mecanismo de origen verificado y un corte de producción independiente.

import {LEGACY_LEAD_COLUMNS,planLegacyLeadMapping} from "./v1-lead-row.js";

const SOURCE="daurel_v1_leads";
const UUID=()=>crypto.randomUUID();
const enc=new TextEncoder();
function shaHex(bytes){
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
async function fingerprint(row){
 // Orden de columnas de la base original; evita diferencias por orden de claves.
 const serial=JSON.stringify(LEGACY_LEAD_COLUMNS.map(k=>row[k]));
 return shaHex(await crypto.subtle.digest("SHA-256",enc.encode(serial)));
}
const error=reason=>({ok:false,reason});
function isSyntheticFixture(row){
 // Defensa adicional, además de NO exponer el helper como endpoint HTTP.
 return row?.name?.startsWith("FICTICIO - ") &&
  row.email?.endsWith("@example.invalid") &&
  row.whatsapp==="5500000000" &&
  row.whatsapp_e164==="525500000000" &&
  row.request_id?.startsWith("DAU-20260101-9");
}
function checkSnapshot(row,mapping){
 if(Object.keys(row).length!==LEGACY_LEAD_COLUMNS.length ||
  LEGACY_LEAD_COLUMNS.some(k=>!Object.hasOwn(row,k)||row[k]===undefined)){
  return "El esquema de origen cambió: requiere revisión.";
 }
 const forbidden=["estado_sin_equivalencia","prioridad_sin_equivalencia",
  "persona_sin_equivalencia","consentimiento_no_booleano"];
 if(mapping.warnings.some(x=>forbidden.includes(x)))return "Datos V1 no compatibles; requieren revisión.";
 if(typeof row.created_at!=="string"||!row.created_at.trim()||
  typeof row.updated_at!=="string"||!row.updated_at.trim()){
  return "Se requieren fechas históricas verificables.";
 }
 if(typeof row.whatsapp!=="string"||typeof row.whatsapp_e164!=="string")
  return "Contacto histórico no reconocido.";
 if(![0,1].includes(row.privacy_consent))return "Consentimiento histórico no válido.";
 if(row.privacy_consent===1&&!row.privacy_consent_at)
  return "No crear consentimiento sin evidencia de su fecha.";
 // Estos datos se conservan solo como metadatos legados: NO se crea
 // la fila V2 "consents" ni se concede acceso a cuentas.
 return null;
}
async function priorImport(db,legacyId){
 return db.prepare([
  "SELECT m.request_id,sr.public_folio,ld.source_sha256",
  "FROM legacy_request_map m",
  "JOIN service_requests sr ON sr.request_id=m.request_id",
  "LEFT JOIN legacy_lead_details ld ON ld.request_id=m.request_id",
  "WHERE m.legacy_source=? AND m.legacy_request_id=?",
  "LIMIT 1",
 ].join(" ")).bind(SOURCE,legacyId).first();
}

// Exportación deliberadamente restringida a tests con datos sintéticos.
// NO llamar desde worker.js. No está conectada a D1 producción ni staging web.
export async function rehearseLegacyImport(db,row){
 if(!isSyntheticFixture(row))return error("Solo se admiten fixtures sintéticos locales.");
 const mapping=planLegacyLeadMapping(row);
 if(!mapping.ok)return error(mapping.reason);
 const invalid=checkSnapshot(row,mapping);
 if(invalid)return error(invalid);
 const digest=await fingerprint(row);
 const legacyId=String(row.id);
 const old=await priorImport(db,legacyId);
 if(old){
  if(old.source_sha256!==digest||old.public_folio!==row.request_id)
   return error("Conflicto: el registro V1 cambió desde el primer ensayo.");
  return {ok:true,imported:false,replayed:true,public_folio:old.public_folio,
   legacy_record_id:legacyId};
 }
 const partyId=UUID(),requestId=UUID();
 const statements=[
  db.prepare([
   "INSERT INTO parties(party_id,kind,display_name)",
   "VALUES (?,?,?)",
  ].join(" ")).bind(partyId,mapping.party.kind,mapping.party.display_name),
 ];
 if(mapping.party.kind==="person"){
  statements.push(db.prepare("INSERT INTO persons(party_id) VALUES (?)").bind(partyId));
 }else{
  statements.push(db.prepare("INSERT INTO organizations(party_id) VALUES (?)").bind(partyId));
 }
 for(const contact of mapping.party.contacts){
  statements.push(db.prepare([
   "INSERT INTO party_contacts",
   "(contact_id,party_id,contact_type,contact_value,normalized_value,verified_at,preferred)",
   "VALUES (?,?,?,?,?,NULL,?)",
  ].join(" ")).bind(
   UUID(),partyId,contact.type,contact.value,contact.normalized_value,
   contact.type==="whatsapp"?1:0,
  ));
 }
 statements.push(
  db.prepare([
   "INSERT INTO service_requests",
   "(request_id,public_folio,requester_party_id,summary,intake_channel,",
   "priority,status,location_text,opened_at,updated_at)",
   "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ].join(" ")).bind(
   requestId,row.request_id,partyId,row.situation,
   "legacy_v1_web",row.priority,row.status,row.location,row.created_at,row.updated_at,
  ),
  db.prepare([
   "INSERT INTO request_participants(request_id,party_id,role)",
   "VALUES (?,?,'requester')",
  ].join(" ")).bind(requestId,partyId),
  db.prepare([
   "INSERT INTO legacy_request_map(legacy_source,legacy_request_id,request_id)",
   "VALUES (?,?,?)",
  ].join(" ")).bind(SOURCE,legacyId,requestId),
  db.prepare([
   "INSERT INTO legacy_lead_details(",
   "request_id,source_record_id,source_sha256,key_answer,category_front,",
   "category_internal,urgency,routing_queue,follow_up_status,follow_up_count,",
   "privacy_consent,privacy_consent_at,needs_human_review,professional_assigned,",
   "deadline_verified,deadline_basis,deadline_notes,documents_status,documents_requested",
   ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ].join(" ")).bind(
   requestId,row.id,digest,row.key_answer,row.category_front,row.category_internal,
   row.urgency,row.routing_queue,row.follow_up_status,row.follow_up_count,
   row.privacy_consent,row.privacy_consent_at,row.needs_human_review,
   row.professional_assigned,row.deadline_verified,row.deadline_basis,
   row.deadline_notes,row.documents_status,row.documents_requested,
  ),
 );
 try{
  // D1 batch es transaccional: no deja mitad de expediente si falla algo.
  await db.batch(statements);
 }catch(e){
  if(/unique|constraint failed|primary key/i.test(String(e))){
   // Si hubo competencia por el mismo registro, comprobar antes de anunciar éxito.
   const competing=await priorImport(db,legacyId);
   if(competing?.source_sha256===digest&&competing?.public_folio===row.request_id){
    return {ok:true,imported:false,replayed:true,
     public_folio:row.request_id,legacy_record_id:legacyId};
   }
   return error("Folio o ID histórico en conflicto: ensayo revertido.");
  }
  throw e;
 }
 return {ok:true,imported:true,replayed:false,
  public_folio:row.request_id,legacy_record_id:legacyId,
  flags:mapping.warnings.filter(x=>x!=="metadatos_v1_requieren_almacenamiento_historico"),
 };
}
