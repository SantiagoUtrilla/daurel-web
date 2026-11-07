// DAUREL V2 - API experimental de staging. SOLO datos sintéticos.
// No es el formulario público ni utiliza información personal.
const DEMO_CHANNEL = "daurel-v2-demo";
const DEMO_SOURCE = "intake-v1";
const CASE_SUMMARIES = Object.freeze({
  general: "Solicitud ficticia: orientación general",
  laboral: "Solicitud ficticia: consulta laboral",
  civil: "Solicitud ficticia: asunto civil",
  marcas: "Solicitud ficticia: registro de marca",
});

export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(String(value)),
  ));
}

export async function authorizeDemo(request, secret) {
  if (typeof secret !== "string" || secret.length < 32) return "not_configured";
  const received = request.headers.get("Authorization") || "";
  if (!received.startsWith("Bearer ") || received.length > 300) return "unauthorized";
  const token = received.slice(7);
  if (!token) return "unauthorized";
  const [actual, expected] = await Promise.all([sha256(token), sha256(secret)]);
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0 ? "authorized" : "unauthorized";
}

function validClientKey(key) {
  return typeof key === "string" && /^demo-[a-z0-9_-]{1,32}$/.test(key);
}

export function validateDemoPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "JSON inválido." };
  }
  if (Object.keys(value).some((key) => !["client_key", "case_type"].includes(key))) {
    return { error: "Solo se admiten client_key y case_type ficticios." };
  }
  if (!validClientKey(value.client_key)) {
    return { error: "client_key debe empezar por demo- y contener caracteres a-z, 0-9, _ o -." };
  }
  if (!Object.hasOwn(CASE_SUMMARIES, value.case_type)) {
    return { error: "case_type no está permitido." };
  }
  return { clientKey: value.client_key, summary: CASE_SUMMARIES[value.case_type] };
}

function dayCodeInMexico() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (name) => parts.find((part) => part.type === name)?.value || "";
  return get("year") + get("month") + get("day");
}

function randomFolio() {
  const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return "DAU-" + dayCodeInMexico() + "-" + String(digits).padStart(4, "0");
}

async function findPriorEvent(db, idemKey) {
  return db.prepare([
    "SELECT sr.request_id, sr.public_folio, sr.summary, ei.provider_user_id AS client_key",
    "FROM integration_events ie",
    "JOIN service_requests sr ON sr.request_id = ie.request_id",
    "JOIN external_identities ei ON ei.party_id = sr.requester_party_id",
    "AND ei.channel_account_id = ?",
    "WHERE ie.provider = 'staging' AND ie.source_scope = ?",
    "AND ie.external_event_id = ? LIMIT 1",
  ].join(" ")).bind(DEMO_CHANNEL, DEMO_SOURCE, idemKey).first();
}

function replayResponse(prior, clientKey, summary) {
  if (prior.client_key !== clientKey || prior.summary !== summary) {
    return json({ success: false, message: "Esa clave de idempotencia corresponde a otra solicitud." }, 409);
  }
  return json({
    success: true, replayed: true, client_key: clientKey,
    request_id: prior.request_id, public_folio: prior.public_folio,
  });
}

async function findParty(db, clientKey) {
  return db.prepare(
    "SELECT party_id FROM external_identities WHERE channel_account_id = ? AND provider_user_id = ? LIMIT 1"
  ).bind(DEMO_CHANNEL, clientKey).first();
}

export async function createDemoRequest(request, env) {
  const idemKey = request.headers.get("Idempotency-Key") || "";
  if (!/^[A-Za-z0-9._-]{8,100}$/.test(idemKey)) {
    return json({ success: false, message: "Falta Idempotency-Key (8 a 100 caracteres seguros)." }, 400);
  }
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return json({ success: false, message: "Se requiere Content-Type: application/json." }, 415);
  }
  if (Number(request.headers.get("Content-Length") || 0) > 2048) {
    return json({ success: false, message: "Solicitud demasiado grande." }, 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 2048) {
    return json({ success: false, message: "Solicitud demasiado grande." }, 413);
  }
  let payload;
  try { payload = JSON.parse(raw); }
  catch { return json({ success: false, message: "JSON inválido." }, 400); }
  const checked = validateDemoPayload(payload);
  if (checked.error) return json({ success: false, message: checked.error }, 400);
  const { clientKey, summary } = checked;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const prior = await findPriorEvent(env.DB, idemKey);
    if (prior) return replayResponse(prior, clientKey, summary);
    const party = await findParty(env.DB, clientKey);
    const partyId = party?.party_id || crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const folio = randomFolio();
    const statements = [];
    if (!party) {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO channel_accounts(channel_account_id, provider, provider_account_id, label) VALUES (?, ?, ?, ?)"
        ).bind(DEMO_CHANNEL, "staging", "daurel-v2-demo", "DAUREL synthetic fixtures"),
        env.DB.prepare("INSERT INTO parties(party_id, kind, display_name) VALUES (?, 'person', ?)")
          .bind(partyId, "Cliente ficticio " + clientKey),
        env.DB.prepare("INSERT INTO persons(party_id) VALUES (?)").bind(partyId),
        env.DB.prepare(
          "INSERT INTO external_identities(identity_id, party_id, channel_account_id, provider_user_id) VALUES (?, ?, ?, ?)"
        ).bind(crypto.randomUUID(), partyId, DEMO_CHANNEL, clientKey),
      );
    }
    statements.push(
      env.DB.prepare(
        "INSERT INTO service_requests(request_id, public_folio, requester_party_id, summary, intake_channel) VALUES (?, ?, ?, ?, 'staging_demo')"
      ).bind(requestId, folio, partyId, summary),
      env.DB.prepare(
        "INSERT INTO request_participants(request_id, party_id, role) VALUES (?, ?, 'requester')"
      ).bind(requestId, partyId),
      env.DB.prepare(
        "INSERT INTO request_events(event_id, request_id, event_type, summary) VALUES (?, ?, 'request_created', ?)"
      ).bind(crypto.randomUUID(), requestId, "Solicitud de prueba creada"),
      env.DB.prepare(
        "INSERT INTO integration_events(integration_event_id, provider, source_scope, external_event_id, request_id, status, processed_at) VALUES (?, 'staging', ?, ?, ?, 'completed', CURRENT_TIMESTAMP)"
      ).bind(crypto.randomUUID(), DEMO_SOURCE, idemKey, requestId),
    );

    try {
      // D1 batch: todas las escrituras se confirman o se revierten juntas.
      await env.DB.batch(statements);
      return json({
        success: true, replayed: false, client_key: clientKey,
        request_id: requestId, public_folio: folio,
      }, 201);
    } catch (error) {
      // Colisión de folio, cliente paralelo o reenvío simultáneo.
      if (!/unique|constraint failed:.*unique/i.test(String(error))) throw error;
    }
  }
  return json({ success: false, message: "Prueba no completada; reintenta con la misma Idempotency-Key." }, 409);
}

export async function listDemoClientRequests(clientKey, env) {
  if (!validClientKey(clientKey)) {
    return json({ success: false, message: "Identificador de prueba inválido." }, 400);
  }
  const party = await findParty(env.DB, clientKey);
  if (!party) return json({ success: true, client_key: clientKey, requests: [], count: 0 });
  const found = await env.DB.prepare([
    "SELECT request_id, public_folio, summary, status, opened_at FROM service_requests",
    "WHERE requester_party_id = ? AND intake_channel = 'staging_demo'",
    "ORDER BY opened_at DESC, request_id DESC LIMIT 30"
  ].join(" ")).bind(party.party_id).all();
  const requests = found.results || [];
  return json({ success: true, client_key: clientKey, party_id: party.party_id, requests, count: requests.length });
}
