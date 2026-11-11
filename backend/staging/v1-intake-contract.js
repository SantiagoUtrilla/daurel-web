// DAUREL V2 — Adaptador PURO del contrato público DAUREL V1 a la entidad de
// solicitud de V2. No escribe en D1, no importa datos reales, no envía Telegram.
//
// V1 public/script.js hace POST /solicitudes con exactamente estas claves.
// Turnstile debe validarse en el backend que recibe la solicitud. La presencia
// del token no demuestra que sea válido; nunca copiarlo a la nueva base.
//
// En el corte a producción se requerirá reconciliar el ID histórico/fuente,
// consentimiento verificable y autorización de acceso por operador. NUNCA
// conceder account_request_access basándose solo en WhatsApp/nombre.

export const V1_FORM_FIELDS=Object.freeze([
 "persona","situation","key_answer","category_front","category_internal",
 "urgency","priority","name","whatsapp","location","privacy_consent","turnstile_token",
]);
export const V1_CATEGORIES=Object.freeze([
 "laboral","accidente","deuda","familiar","marca","citatorio","contrato","general",
]);
const CATEGORY=new Set(V1_CATEGORIES);
const PERSON=new Set(["particular","empresa"]);
const URGENCY=new Set(["unknown","48h","soon","no"]);
function clean(v,max){
 if(typeof v!=="string")return null;
 const t=v.trim().replace(/\s+/gu," ");
 return t&&t.length<=max?t:null;
}
function validPhone(v){
 return typeof v==="string"&&/^\d{10,15}$/.test(v);
}
function copySafe(source){
 return Object.keys(source).sort().join(",")===V1_FORM_FIELDS.slice().sort().join(",");
}
function reject(reason){return {ok:false,error:reason}}
export function normalizeV1Intake(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||!copySafe(input)){
  return reject("Estructura de la solicitud V1 no reconocida.");
 }
 if(!PERSON.has(input.persona))return reject("Tipo de solicitante inválido.");
 const name=clean(input.name,150);
 const situation=clean(input.situation,3000);
 const answer=clean(input.key_answer,500);
 const location=clean(input.location,150);
 if(!name||name.length<2||!situation||situation.length<12||!location||location.length<2||
    !validPhone(input.whatsapp)||!answer){
  return reject("Faltan datos mínimos para conservar la solicitud.");
 }
 if(!CATEGORY.has(input.category_front)||!CATEGORY.has(input.category_internal)){
  return reject("Categoría V1 no reconocida.");
 }
 // Evitar cambios de categorización no revisados durante una migración.
 if(input.category_front!==input.category_internal){
  return reject("La categoría interna y la pública requieren revisión manual.");
 }
 if(typeof input.urgency!=="string"||input.urgency.length>32)
  return reject("Urgencia inválida.");
 // V1 podría persistir categorías de urgencia adicionales; se conservan
 // solo si son de las opciones verificadas, en lugar de inventar plazos.
 const urgency=URGENCY.has(input.urgency)?input.urgency:null;
 if(urgency===null)return reject("Urgencia V1 no reconocida: revisar el origen.");
 if(input.priority!==(urgency==="48h"?"high":"normal"))
  return reject("Prioridad y urgencia inconsistentes.");
 if(input.privacy_consent!==true)
  return reject("No hay constancia de aceptación inicial del aviso de privacidad.");
 // El marcador se valida en origen y se descarta al importar. No lo tratamos
 // como prueba de que se verificó en Cloudflare.
 if(!clean(input.turnstile_token,4096))
  return reject("Falta el dato de verificación usado en V1.");
 return {
  ok:true,
  party:{
   kind:input.persona==="empresa"?"organization":"person",
   display_name:name,
   contact_type:"whatsapp",
   contact_value:input.whatsapp,
   location_text:location,
  },
  request:{
   summary:situation,
   intake_channel:"web",
   status:"new",
   priority:input.priority,
   source_category:input.category_internal,
   source_urgency:urgency,
   source_key_answer:answer,
  },
  consent:{
   action:"accept",document_type:"privacy_notice",
   source:"web_v1",
   // La versión exacta, fecha y medio deberán recuperarse de la evidencia V1;
   // no se inventan al transformar el payload.
   document_version:null,
   recorded_at:null,
  },
  source:{
   system:"DAUREL_V1",
   // Request ID y folio no vienen en el payload; los asigna V1 al guardar.
   // Se importarán desde el registro CONFIRMADO, nunca se regenerarán.
   requires_legacy_request_id:true,
   preserve_existing_public_folio:true,
  },
  account_access:{
   auto_link:false,
   requires_manual_authorization:true,
  },
 };
}
