// DAUREL V2 - Expediente por cliente con historial por asunto (solo staging).
// Acceso al endpoint restringido por STAGING_TEST_TOKEN en el Worker.
// Solo datos sintéticos, tipos de actuación predefinidos, sin texto libre.

import { json } from "./demo-api.js";

const DEMO_CHANNEL = "daurel-v2-demo";
const ACTIONS = Object.freeze({
  review: {
    event_type: "documentation_review",
    summary: "Actuación ficticia: documentación revisada",
  },
  followup: {
    event_type: "follow_up",
    summary: "Actuación ficticia: seguimiento registrado",
  },
  information: {
    event_type: "information_requested",
    summary: "Actuación ficticia: información solicitada",
  },
});

function validClientKey(value) {
  return typeof value === "string" && /^demo-[a-z0-9_-]{1,32}$/.test(value);
}

function validRequestId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validIdempotencyKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{8,100}$/.test(value);
}

async function actionId(requestId, key) {
  const buffer = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode("daurel-v2-note:" + requestId + ":" + key)
  );
  return "demo-note-" + Array.from(new Uint8Array(buffer),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getDemoDossier(env, clientKey) {
  if (!validClientKey(clientKey)) {
    return json({ success: false, message: "Cliente ficticio inválido." }, 400);
  }

  const client = await env.DB.prepare([
    "SELECT p.party_id, p.kind, p.display_name",
    "FROM external_identities ei JOIN parties p ON p.party_id = ei.party_id",
    "WHERE ei.channel_account_id = ? AND ei.provider_user_id = ? LIMIT 1",
  ].join(" ")).bind(DEMO_CHANNEL, clientKey).first();
  if (!client) {
    return json({
      success: true, environment: "staging", client_key: clientKey,
      client: null, matters: [], count: 0,
    });
  }

  const result = await env.DB.prepare([
    "SELECT request_id, public_folio, summary, status, opened_at, updated_at",
    "FROM service_requests",
    "WHERE requester_party_id = ? AND intake_channel = 'staging_demo'",
    "ORDER BY opened_at DESC, request_id DESC LIMIT 30",
  ].join(" ")).bind(client.party_id).all();

  const matters = (result.results || []).map((matter) => ({ ...matter, events: [] }));
  const index = new Map(matters.map((matter) => [matter.request_id, matter]));

  if (matters.length) {
    const events = await env.DB.prepare([
      "SELECT re.event_id, re.request_id, re.event_type, re.summary, re.created_at",
      "FROM request_events re",
      "JOIN service_requests sr ON sr.request_id = re.request_id",
      "WHERE sr.requester_party_id = ? AND sr.intake_channel = 'staging_demo'",
      "ORDER BY re.created_at DESC, re.event_id DESC LIMIT 600",
    ].join(" ")).bind(client.party_id).all();
    for (const event of events.results || []) {
      const matter = index.get(event.request_id);
      if (matter && matter.events.length < 30) matter.events.push(event);
    }
    for (const matter of matters) {
      matter.events.sort((a, b) => a.created_at.localeCompare(b.created_at)
        || a.event_id.localeCompare(b.event_id));
    }
  }

  return json({
    success: true,
    environment: "staging",
    client_key: clientKey,
    client: { party_id: client.party_id, display_name: client.display_name, kind: client.kind },
    matters, count: matters.length,
    limits: { matters: 30, events_per_matter: 30 },
  });
}

export async function recordDemoAction(request, env, requestId) {
  if (!validRequestId(requestId)) {
    return json({ success: false, message: "Identificador de asunto inválido." }, 400);
  }
  const key = request.headers.get("Idempotency-Key") || "";
  if (!validIdempotencyKey(key)) {
    return json({ success: false, message: "Falta Idempotency-Key válido." }, 400);
  }
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return json({ success: false, message: "Se requiere application/json." }, 415);
  }
  if (Number(request.headers.get("Content-Length") || 0) > 1024) {
    return json({ success: false, message: "Contenido demasiado grande." }, 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 1024) {
    return json({ success: false, message: "Contenido demasiado grande." }, 413);
  }
  let payload;
  try { payload = JSON.parse(raw); } catch {
    return json({ success: false, message: "JSON inválido." }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).some((field) => !["client_key", "action"].includes(field))) {
    return json({ success: false, message: "Solo client_key y action ficticios." }, 400);
  }
  const { client_key: clientKey, action } = payload;
  if (!validClientKey(clientKey) || !Object.hasOwn(ACTIONS, action)) {
    return json({ success: false, message: "Datos ficticios inválidos." }, 400);
  }

  const matter = await env.DB.prepare([
    "SELECT sr.request_id",
    "FROM service_requests sr JOIN external_identities ei",
    "ON ei.party_id = sr.requester_party_id",
    "WHERE sr.request_id = ? AND sr.intake_channel = 'staging_demo'",
    "AND ei.channel_account_id = ? AND ei.provider_user_id = ? LIMIT 1",
  ].join(" ")).bind(requestId, DEMO_CHANNEL, clientKey).first();
  if (!matter) {
    return json({ success: false, message: "Asunto ficticio no encontrado para ese cliente." }, 404);
  }

  const eventId = await actionId(requestId, key);
  const expected = ACTIONS[action];

  const existing = await env.DB.prepare(
    "SELECT event_id, event_type, summary, created_at FROM request_events WHERE event_id = ?"
  ).bind(eventId).first();
  if (existing) {
    if (existing.event_type !== expected.event_type || existing.summary !== expected.summary) {
      return json({ success: false, message: "Idempotency-Key ya utilizada para otra actuación." }, 409);
    }
    return json({ success: true, replayed: true, request_id: requestId, event: existing });
  }

  // Identificador determinista + INSERT OR IGNORE: la misma operación solo genera
  // una actuación aunque llegue repetida o concurrentemente.
  await env.DB.prepare([
    "INSERT OR IGNORE INTO request_events(event_id, request_id, event_type, summary)",
    "SELECT ?, sr.request_id, ?, ?",
    "FROM service_requests sr JOIN external_identities ei",
    "ON ei.party_id = sr.requester_party_id",
    "WHERE sr.request_id = ? AND sr.intake_channel = 'staging_demo'",
    "AND ei.channel_account_id = ? AND ei.provider_user_id = ?",
  ].join(" ")).bind(
    eventId, expected.event_type, expected.summary,
    requestId, DEMO_CHANNEL, clientKey,
  ).run();

  const created = await env.DB.prepare(
    "SELECT event_id, event_type, summary, created_at FROM request_events WHERE event_id = ?"
  ).bind(eventId).first();
  if (!created) {
    return json({ success: false, message: "No se registró la actuación." }, 409);
  }
  if (created.event_type !== expected.event_type || created.summary !== expected.summary) {
    return json({ success: false, message: "Idempotency-Key ya utilizada para otra actuación." }, 409);
  }

  return json({
    success: true, replayed: false,
    request_id: requestId, event: created,
  }, 201);
}
