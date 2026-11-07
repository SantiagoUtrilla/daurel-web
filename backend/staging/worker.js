// DAUREL V2 - Worker de staging. Solo pruebas, nunca tráfico de clientes.
import {
  authorizeDemo, createDemoRequest, listDemoClientRequests, json,
} from "./demo-api.js";

const REQUIRED_TABLES = [
  "parties", "persons", "organizations", "party_contacts", "channel_accounts",
  "external_identities", "professions", "services", "service_professions",
  "service_requests", "request_participants", "conversations",
  "conversation_participants", "conversation_request_links",
  "integration_events", "request_events", "consents", "legacy_request_map",
];

async function health(env) {
  try {
    const connectivity = await env.DB.prepare("SELECT 1 AS ok").first();
    if (connectivity?.ok !== 1) throw new Error("D1 connectivity check failed");
    const { results = [] } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all();
    const present = new Set(results.map((row) => row.name));
    const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table));
    return json({
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
  } catch {
    console.error("DAUREL staging healthcheck failed");
    return json({ service: "DAUREL V2 staging", status: "unavailable" }, 503);
  }
}

export default {
  async fetch(request, env) {
    // Bloqueo independiente de dominio: nunca operar con otra configuración.
    if (env.ENVIRONMENT !== "staging") {
      return json({ success: false, message: "Forbidden" }, 403);
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return health(env);
    }

    const isDemoCreate = request.method === "POST" && url.pathname === "/v2/demo/requests";
    const clientMatch = request.method === "GET"
      ? /^\/v2\/demo\/clients\/([^/]+)$/.exec(url.pathname)
      : null;

    if (!isDemoCreate && !clientMatch) {
      return json({ success: false, message: "Ruta no disponible en staging." }, 404);
    }

    const auth = await authorizeDemo(request, env.STAGING_TEST_TOKEN);
    if (auth === "not_configured") {
      return json({ success: false, message: "API de pruebas deshabilitada: falta configurar Secret." }, 503);
    }
    if (auth !== "authorized") {
      return json({ success: false, message: "Acceso no autorizado." }, 401);
    }

    try {
      if (isDemoCreate) return await createDemoRequest(request, env);
      return await listDemoClientRequests(decodeURIComponent(clientMatch[1]), env);
    } catch {
      console.error("DAUREL staging demo API error");
      return json({ success: false, message: "Error interno de prueba; no reintentes con una clave de idempotencia diferente." }, 500);
    }
  },
};
