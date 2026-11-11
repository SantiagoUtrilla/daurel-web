-- DAUREL V2 · 0005 / preservación de metadatos legados V1.
-- DISEÑO DE PRUEBAS, NO APLICAR EN daurel-db (producción).
-- No ejecutar en D1 staging antes de validar ensayos, backups e historial Wrangler.
-- Estos campos son información PRIVADA: solo uso administrativo autorizado.
-- Ninguna consulta del portal cliente debe exponer esta tabla.

CREATE TABLE IF NOT EXISTS legacy_lead_details (
  request_id TEXT NOT NULL PRIMARY KEY
    REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  source_record_id INTEGER NOT NULL UNIQUE
    CHECK (source_record_id > 0),
  source_sha256 TEXT NOT NULL
    CHECK (length(source_sha256) = 64),
  key_answer TEXT,
  category_front TEXT,
  category_internal TEXT,
  urgency TEXT,
  routing_queue TEXT,
  follow_up_status TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0
    CHECK (follow_up_count >= 0),
  privacy_consent INTEGER
    CHECK (privacy_consent IN (0, 1)),
  privacy_consent_at TEXT,
  needs_human_review INTEGER,
  professional_assigned TEXT,
  deadline_verified INTEGER,
  deadline_basis TEXT,
  deadline_notes TEXT,
  documents_status TEXT,
  documents_requested TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_legacy_lead_details_consent
  ON legacy_lead_details(privacy_consent, privacy_consent_at);
