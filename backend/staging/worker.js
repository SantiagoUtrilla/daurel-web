// DAUREL V2 - Worker de pruebas: verificación de conectividad y esquema D1.
// No recibe solicitudes reales, no envía mensajes y no habilita acceso administrativo.

const REQUIRED_TABLES = [
  "parties",
  "persons",
  "organizations",
  "party_contacts",
  "channel_accounts",
  "external_identities",
  "professions",
  "services",
  "service_professions",
  "service_requests",
  "request_participants",
  "conversations",
  "conversation_participants",
  "conversation_request_links",
  "integration_events",
  "request_events",
  "consents",
  "legacy_request_map",
];

function response(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    // Cierre de seguridad: el código únicamente puede ejecutarse en staging.
    if (env.ENVIRONMENT !== "staging") {
      return response({ success: false, message: "Forbidden" }, 403);
    }

    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/health") {
      return response({ success: false, message: "Ruta no disponible en staging." }, 404);
    }

    try {
      const connectivity = await env.DB.prepare("SELECT 1 AS ok").first();
      if (connectivity?.ok !== 1) {
        throw new Error("D1 connectivity check failed");
      }

      const { results = [] } = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      ).all();
      const present = new Set(results.map((row) => row.name));
      const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table));

      return response({
        service: "DAUREL V2 staging",
        status: missingTables.length ? "schema_incomplete" : "online",
        database: "connected",
        schema: {
          version: "0001_v2_core.sql",
          ready: missingTables.length === 0,
          expected_tables: REQUIRED_TABLES.length,
          found_tables: REQUIRED_TABLES.length - missingTables.length,
          missing_tables: missingTables,
        },
      }, missingTables.length ? 503 : 200);
    } catch (_error) {
      console.error("DAUREL staging database healthcheck failed");
      return response({
        service: "DAUREL V2 staging",
        status: "unavailable",
      }, 503);
    }
  },
};
