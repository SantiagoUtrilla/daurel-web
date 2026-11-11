// DAUREL V2 · PLANEACIÓN PURA de importación de una fila de "leads" V1.
// Nunca consulta, altera o copia datos de daurel-db. Usar SOLO fixtures ficticios
// hasta contar con aprobación de privacidad, respaldos y permisos reales.
//
// Fuente verificada: PRAGMA table_info('leads') en D1 V1 + main/public/admin.js.
// V1 "id" es identidad estable interna, V1 "request_id" es folio público visible.
// La fase siguiente tendrá que diseñar una importación transaccional reversible,
// con cada campo no representado en V2 conservado en una estructura trazable.

export const LEGACY_LEAD_COLUMNS=Object.freeze([
 "id","request_id","persona","name","whatsapp","whatsapp_e164","email",
 "location","situation","key_answer","category_front","category_internal",
 "urgency","priority","routing_queue","status","follow_up_status",
 "follow_up_count","privacy_consent","privacy_consent_at","needs_human_review",
 "professional_assigned","deadline_verified","deadline_basis","deadline_notes",
 "documents_status","documents_requested","created_at","updated_at",
]);
const V2_STATUSES=new Set(["new","contacted","in_attention","closed","cancelled"]);
const V2_PRIORITY=new Set(["normal","medium","high"]);
const V1_PERSONA=new Map([["particular","person"],["empresa","organization"]]);
const FOLIO=/^DAU-[0-9]{8}-[0-9]{4,}$/;
const text=(v,max=10000)=>typeof v==="string"&&v.trim().length&&v.length<=max?v:null;
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function resultError(why){return {ok:false,reason:why};}

// This converter does NOT sanitize/summarize private content in any UI.
// The return object is a planning representation; never serve it in a route.
export function planLegacyLeadMapping(row){
 if(!row||typeof row!=="object"||Array.isArray(row))
  return resultError("El registro no es una fila V1.");
 if(LEGACY_LEAD_COLUMNS.some(c=>!has(row,c)))
  return resultError("Faltan columnas de la estructura de leads V1.");
 if(!Number.isSafeInteger(row.id)||row.id<=0||!text(row.request_id,120))
  return resultError("Falta la identidad histórica o el folio.");
 if(!text(row.name,250)||!text(row.situation,20000))
  return resultError("Los datos mínimos del registro V1 no son válidos.");
 if(!Number.isSafeInteger(row.follow_up_count)||row.follow_up_count<0)
  return resultError("El contador de seguimiento histórico requiere revisión.");
 const warnings=[];
 if(!V1_PERSONA.has(row.persona))warnings.push("persona_sin_equivalencia");
 if(!V2_STATUSES.has(row.status))warnings.push("estado_sin_equivalencia");
 if(!V2_PRIORITY.has(row.priority))warnings.push("prioridad_sin_equivalencia");
 if(!FOLIO.test(row.request_id))warnings.push("formato_folio_revisar");
 if(![0,1].includes(row.privacy_consent))warnings.push("consentimiento_no_booleano");
 if(row.privacy_consent===1&&!text(row.privacy_consent_at,100))
  warnings.push("consentimiento_sin_fecha");
 // Nunca presumir que existe documento_version V2; es NOT NULL en consents.
 // No usar la fecha de creación de solicitud como fecha de consentimiento.
 warnings.push("version_aviso_privacidad_no_acreditada");
 // Los campos V1 no representados explícitamente deben tener destino seguro
 // y registro histórico antes de una importación de información sensible.
 warnings.push("metadatos_v1_requieren_almacenamiento_historico");
 if(row.deadline_verified===1&&text(row.deadline_notes,10000))
  warnings.push("plazos_requieren_revision_humana");
 return {
  ok:true,mode:"planning_only",auto_import_allowed:false,
  source:{system:"daurel_v1",table:"leads",pk:String(row.id),public_folio:row.request_id},
  // Para legacy_request_map(legacy_source,legacy_request_id,request_id)
  legacy_map:{legacy_source:"daurel_v1_leads",legacy_request_id:String(row.id)},
  party:{
   // Una party PROVISIONAL por registro: ninguna unificación por WhatsApp,
   // correo o nombre hasta acreditar identidad/titularidad.
   provisional_separate_per_lead:true,
   kind:V1_PERSONA.get(row.persona)||"unknown",
   display_name:row.name,
   contacts:[
    ...(text(row.whatsapp,40)?[{
     type:"whatsapp",value:row.whatsapp,normalized_value:text(row.whatsapp_e164,40),
     verified_at:null,
    }]:[]),
    ...(text(row.email,254)?[{
     type:"email",value:row.email,normalized_value:row.email.trim().toLowerCase(),
     verified_at:null,
    }]:[]),
   ],
  },
  request:{
   public_folio:row.request_id,
   summary:row.situation,
   location_text:row.location,
   // no se inventa estado si el valor de V1 no existe en V2
   status:V2_STATUSES.has(row.status)?row.status:null,
   priority:V2_PRIORITY.has(row.priority)?row.priority:null,
   intake_channel:"legacy_v1_web",
   opened_at:row.created_at||null,
   updated_at:row.updated_at||null,
  },
  consent:{
   legacy_consent:row.privacy_consent,
   legacy_recorded_at:row.privacy_consent_at||null,
   v2_document_version:null,
   may_create_v2_consent:false,
  },
  untransferred_legacy:{
   key_answer:row.key_answer,
   category_front:row.category_front,
   category_internal:row.category_internal,
   urgency:row.urgency,
   routing_queue:row.routing_queue,
   follow_up_status:row.follow_up_status,
   follow_up_count:row.follow_up_count,
   needs_human_review:row.needs_human_review,
   professional_assigned:row.professional_assigned,
   deadline_verified:row.deadline_verified,
   deadline_basis:row.deadline_basis,
   deadline_notes:row.deadline_notes,
   documents_status:row.documents_status,
   documents_requested:row.documents_requested,
  },
  account_access:{automatic:false,requires_identity_and_explicit_grant:true},
  warnings,
 };
}
