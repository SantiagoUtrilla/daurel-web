// Pruebas offline de DAUREL V2. No conectan con Cloudflare ni usan datos reales.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  authorizeDemo, validateDemoPayload, createDemoRequest, listDemoClientRequests, getDemoAdminOverview,
} from "./demo-api.js";

const SECRET = "clave-sintetica-local-no-usar-en-cloudflare-12345";

class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    const sql = readFileSync(new URL("../migrations/0001_v2_core.sql", import.meta.url), "utf8");
    this.sqlite.exec(sql);
  }

  prepare(sql) {
    const db = this.sqlite;
    const make = (args) => ({
      run: async () => ({ success: true, meta: db.prepare(sql).run(...args) }),
      first: async () => db.prepare(sql).get(...args) || null,
      all: async () => ({ success: true, results: db.prepare(sql).all(...args) }),
    });
    return { ...make([]), bind: (...args) => make(args) };
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN TRANSACTION");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function request(key, caseType, idemKey) {
  return new Request("https://staging.invalid/v2/demo/requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + SECRET,
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify({ client_key: key, case_type: caseType }),
  });
}

test("Auth: faltante / incorrecta / válida", async () => {
  const q = new Request("https://staging.invalid/v2/demo/requests", {
    headers: { Authorization: "Bearer " + SECRET },
  });
  assert.equal(await authorizeDemo(q, ""), "not_configured");
  assert.equal(await authorizeDemo(q, "otra-clave-larga-sintetica-abcdefghijklmnopqrstuvwxyz"), "unauthorized");
  assert.equal(await authorizeDemo(q, SECRET), "authorized");
});

test("Validación impide contenido real y permite únicamente valores sintéticos", () => {
  assert.ok(validateDemoPayload({client_key:"demo-uno",case_type:"laboral"}).summary);
  assert.ok(validateDemoPayload({client_key:"ana",case_type:"laboral"}).error);
  assert.ok(validateDemoPayload({client_key:"demo-uno",case_type:"laboral",whatsapp:"5512345678"}).error);
  assert.ok(validateDemoPayload({client_key:"demo-uno",case_type:"penal"}).error);
});

test("Cliente reutilizable, solicitudes múltiples e idempotencia", async () => {
  const DB = new TestD1();
  const env = { DB };
  const first = await createDemoRequest(request("demo-uno", "laboral", "evento-demo-0001"), env);
  assert.equal(first.status, 201);
  const created = await first.json();
  assert.equal(created.replayed, false);
  assert.match(created.public_folio, /^DAU-[0-9]{8}-[0-9]{4}$/);

  const repeat = await createDemoRequest(request("demo-uno", "laboral", "evento-demo-0001"), env);
  assert.equal(repeat.status, 200);
  const repeated = await repeat.json();
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.request_id, created.request_id);

  const another = await createDemoRequest(request("demo-uno", "civil", "evento-demo-0002"), env);
  assert.equal(another.status, 201);
  const second = await another.json();
  assert.notEqual(second.request_id, created.request_id);

  const conflict = await createDemoRequest(request("demo-uno", "marcas", "evento-demo-0001"), env);
  assert.equal(conflict.status, 409);

  const list = await listDemoClientRequests("demo-uno", env);
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.equal(data.count, 2);
  assert.equal(new Set(data.requests.map((r) => r.request_id)).size, 2);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS total FROM parties").get().total, 1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS total FROM persons").get().total, 1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS total FROM request_events").get().total, 2);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS total FROM integration_events").get().total, 2);
});

test("Cliente diferente no fusionado y entrada inválida sin escritura", async () => {
  const DB = new TestD1();
  const env = { DB };
  assert.equal((await createDemoRequest(request("demo-uno","general","evento-demo-0101"),env)).status,201);
  assert.equal((await createDemoRequest(request("demo-dos","general","evento-demo-0102"),env)).status,201);
  const wrong = new Request("https://staging.invalid/v2/demo/requests", {
    method: "POST", headers: { "Content-Type":"application/json", "Idempotency-Key":"evento-demo-0103" },
    body: JSON.stringify({client_key:"demo-tres", case_type:"general", email:"real@example.com"}),
  });
  assert.equal((await createDemoRequest(wrong, env)).status,400);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS total FROM parties").get().total, 2);
});

test("Panel interno V2 muestra solo los clientes y asuntos sintéticos", async () => {
  const DB = new TestD1();
  const env = { DB };
  await createDemoRequest(request("demo-uno", "laboral", "evento-demo-2001"), env);
  await createDemoRequest(request("demo-uno", "civil", "evento-demo-2002"), env);
  await createDemoRequest(request("demo-dos", "marcas", "evento-demo-2003"), env);
  const response = await getDemoAdminOverview(env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.read_only, true);
  assert.equal(data.environment, "staging");
  assert.equal(data.statistics.total_clients, 2);
  assert.equal(data.statistics.total_requests, 3);
  assert.equal(data.statistics.new_requests, 3);
  assert.equal(data.statistics.active_requests, 0);
  assert.equal(data.requests.length, 3);
  assert.ok(data.requests.every((row) => row.client_key.startsWith("demo-")));

  DB.sqlite.prepare("INSERT INTO parties(party_id,kind) VALUES (?, 'person')")
    .run("external-not-demo");
  DB.sqlite.prepare("INSERT INTO service_requests(request_id,public_folio,requester_party_id,summary,intake_channel) VALUES (?,?,?,?,?)")
    .run("test-non-demo", "DAU-NON-DEMO", "external-not-demo", "No debe aparecer", "web");
  const after = await (await getDemoAdminOverview(env)).json();
  assert.equal(after.statistics.total_requests, 3);
  assert.equal(after.statistics.total_clients, 2);
  assert.equal(after.requests.length, 3);
});
