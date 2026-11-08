-- DAUREL V2 / 0002 - Cuentas OPCIONALES, inicio de sesión por email
-- Solo staging. NO aplicar todavía hasta conciliar 0001 en d1_migrations.
-- Las partes (parties) y solicitudes existen sin cuentas.
-- Verificar email no implica acceso automático a ninguna party ni expediente.

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS account_emails (
  email_id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  email_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(email_normalized) BETWEEN 3 AND 254),
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_account_emails_account ON account_emails(account_id);

CREATE TABLE IF NOT EXISTS account_party_access (
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  permission TEXT NOT NULL DEFAULT 'view_own'
    CHECK (permission IN ('view_own','representative')),
  grant_basis TEXT NOT NULL
    CHECK (grant_basis IN ('verified_intake','manual_review','verified_authorization')),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY (account_id, party_id)
);
CREATE INDEX IF NOT EXISTS idx_party_access_party ON account_party_access(party_id, revoked_at);

CREATE TABLE IF NOT EXISTS login_challenges (
  challenge_id TEXT NOT NULL PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  otp_hmac TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_challenges_email
  ON login_challenges(email_normalized, created_at);
CREATE INDEX IF NOT EXISTS idx_login_challenges_expiration
  ON login_challenges(expires_at);

CREATE TABLE IF NOT EXISTS account_sessions (
  session_id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON account_sessions(account_id, expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  subject_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (subject_hash, window_start)
);

CREATE TABLE IF NOT EXISTS account_access_audit (
  audit_id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT REFERENCES accounts(account_id) ON DELETE RESTRICT,
  party_id TEXT REFERENCES parties(party_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('email_verified','session_created','session_revoked',
      'party_granted','party_revoked','access_denied')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_account_audit_account
  ON account_access_audit(account_id, created_at);
