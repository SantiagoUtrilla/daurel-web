-- DAUREL V2 · 0003 | Invitaciones por expediente, únicamente daurel-staging.
-- No ejecutar en daurel-db. El acceso queda denegado sin concesión explícita.
-- Esta migración se aplica manualmente en D1 Studio; el historial d1_migrations
-- aún requiere conciliación antes de utilizar migraciones automáticas.

CREATE TABLE IF NOT EXISTS case_invitations (
  invitation_id TEXT NOT NULL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  intended_email TEXT NOT NULL COLLATE NOCASE,
  code_sha256 TEXT NOT NULL UNIQUE,
  issue_bucket TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sent_at TEXT,
  redeemed_at TEXT,
  redemption_nonce TEXT UNIQUE,
  redeemed_by_account_id TEXT REFERENCES accounts(account_id) ON DELETE RESTRICT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, intended_email, issue_bucket)
);
CREATE INDEX IF NOT EXISTS idx_case_invitations_request
  ON case_invitations(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_case_invitations_email
  ON case_invitations(intended_email, created_at);

CREATE TABLE IF NOT EXISTS account_request_access (
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view')),
  grant_basis TEXT NOT NULL DEFAULT 'case_invitation'
    CHECK (grant_basis IN ('case_invitation', 'manual_review', 'verified_authorization')),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY (account_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_account_request_access_request
  ON account_request_access(request_id, revoked_at);

CREATE TABLE IF NOT EXISTS case_access_audit (
  audit_id TEXT NOT NULL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  account_id TEXT REFERENCES accounts(account_id) ON DELETE RESTRICT,
  invitation_id TEXT REFERENCES case_invitations(invitation_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN
    ('invitation_sent', 'invitation_redeemed', 'access_revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_case_access_audit_request
  ON case_access_audit(request_id, created_at);
