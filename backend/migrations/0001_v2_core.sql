-- DAUREL V2 | Primera migración del núcleo | SOLO staging.
-- No ejecutar contra daurel-db. IDs aleatorios se generan en el Worker.
-- SQLite / Cloudflare D1. Tiempos UTC. Datos reales excluidos de pruebas.

CREATE TABLE IF NOT EXISTS parties (
  party_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('unknown', 'person', 'organization')),
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS persons (
  party_id TEXT PRIMARY KEY REFERENCES parties(party_id) ON DELETE RESTRICT,
  given_names TEXT,
  family_names TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
  party_id TEXT PRIMARY KEY REFERENCES parties(party_id) ON DELETE RESTRICT,
  legal_name TEXT,
  trade_name TEXT
);

CREATE TABLE IF NOT EXISTS party_contacts (
  contact_id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('whatsapp', 'phone', 'email', 'other')),
  contact_value TEXT NOT NULL CHECK (length(trim(contact_value)) > 0),
  normalized_value TEXT,
  verified_at TEXT,
  preferred INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (party_id, contact_type, contact_value)
);
CREATE INDEX IF NOT EXISTS idx_party_contacts_party ON party_contacts(party_id);
CREATE INDEX IF NOT EXISTS idx_party_contacts_lookup ON party_contacts(contact_type, normalized_value);

CREATE TABLE IF NOT EXISTS channel_accounts (
  channel_account_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS external_identities (
  identity_id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  channel_account_id TEXT NOT NULL REFERENCES channel_accounts(channel_account_id) ON DELETE RESTRICT,
  provider_user_id TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE (channel_account_id, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_external_identities_party ON external_identities(party_id);

CREATE TABLE IF NOT EXISTS professions (
  profession_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS services (
  service_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS service_professions (
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE RESTRICT,
  profession_id TEXT NOT NULL REFERENCES professions(profession_id) ON DELETE RESTRICT,
  PRIMARY KEY (service_id, profession_id)
);

CREATE TABLE IF NOT EXISTS service_requests (
  request_id TEXT PRIMARY KEY,
  public_folio TEXT NOT NULL UNIQUE,
  requester_party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  service_id TEXT REFERENCES services(service_id) ON DELETE SET NULL,
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  intake_channel TEXT NOT NULL DEFAULT 'web',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'in_attention', 'closed', 'cancelled')),
  location_text TEXT,
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON service_requests(requester_party_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_requests_queue ON service_requests(status, priority, opened_at);
CREATE INDEX IF NOT EXISTS idx_requests_service ON service_requests(service_id, opened_at);

CREATE TABLE IF NOT EXISTS request_participants (
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('requester', 'beneficiary', 'representative', 'authorized', 'related')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id, party_id, role)
);
CREATE INDEX IF NOT EXISTS idx_request_participants_party ON request_participants(party_id);

CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  channel_account_id TEXT REFERENCES channel_accounts(channel_account_id) ON DELETE RESTRICT,
  external_thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (channel_account_id, external_thread_id)
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'participant',
  PRIMARY KEY (conversation_id, party_id)
);

CREATE TABLE IF NOT EXISTS conversation_request_links (
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_request_links_req ON conversation_request_links(request_id);

CREATE TABLE IF NOT EXISTS integration_events (
  integration_event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_scope TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  request_id TEXT REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE (provider, source_scope, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_integration_events_status ON integration_events(status, received_at);

CREATE TABLE IF NOT EXISTS request_events (
  event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  summary TEXT,
  actor_party_id TEXT REFERENCES parties(party_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_request_events_timeline ON request_events(request_id, created_at);

CREATE TABLE IF NOT EXISTS consents (
  consent_id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  request_id TEXT REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL,
  consent_action TEXT NOT NULL CHECK (consent_action IN ('accept', 'withdraw')),
  source TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_consents_party ON consents(party_id, recorded_at);

CREATE TABLE IF NOT EXISTS legacy_request_map (
  legacy_source TEXT NOT NULL,
  legacy_request_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (legacy_source, legacy_request_id)
);
