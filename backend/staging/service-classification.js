// DAUREL V2 — clasificación determinista de servicios ficticios.
// NO asigna profesionales, no modifica estados, no infiere desde narrativas.
// Los servicios futuros se registrarán en catálogo administrable, con revisión.
const CATALOG=Object.freeze({
 "Solicitud ficticia: consulta laboral":{area:"juridica",area_label:"Jurídica",specialty:"Laboral"},
 "Solicitud ficticia: asunto civil":{area:"juridica",area_label:"Jurídica",specialty:"Civil"},
 "Solicitud ficticia: registro de marca":{area:"juridica",area_label:"Jurídica",specialty:"Propiedad intelectual"},
 "Solicitud ficticia: orientación contable":{area:"contaduria",area_label:"Contaduría",specialty:"Orientación contable"},
 "Solicitud ficticia: orientación general":{area:"por_clasificar",area_label:"Por clasificar",specialty:"Orientación general"},
});
export const AREA_LABELS=Object.freeze({
 juridica:"Jurídica",
 contaduria:"Contaduría",
 por_clasificar:"Por clasificar",
});
// Nunca extrapolar de palabras libres ("demanda", "fiscal", "ingeniero").
// Un desconocido queda visible para clasificación humana, no desaparece.
export function classifySyntheticRequest(summary){
 const item=Object.hasOwn(CATALOG,summary)?CATALOG[summary]:null;
 return item?{...item,classification:"catalog"}:{
  area:"por_clasificar",area_label:"Por clasificar",
  specialty:"Revisión necesaria",classification:"requires_review",
 };
}
export function countSyntheticAreas(cases){
 const result={juridica:0,contaduria:0,por_clasificar:0};
 for(const c of cases){
  const area=c.area||classifySyntheticRequest(c.summary).area;
  result[area]=(result[area]||0)+1;
 }
 return result;
}
