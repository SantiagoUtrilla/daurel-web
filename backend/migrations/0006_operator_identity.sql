-- DAUREL V2 · 0006 / cuentas y sesiones de operadores, SOLO staging.
-- Nunca ejecutar en daurel-db (producción).
-- Instalación manual una vez en daurel-staging; conciliar historial Wrangler.
-- El correo de un cliente y su cookie NO conceden permisos administrativos.

CREATE TABLE IF NOT EXISTS operator_memberships (
 account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts(account_id) ON DELETE RESTRICT,
 role TEXT NOT NULL CHECK(role IN ('owner','manager','reader')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_one_active_owner
 ON operator_memberships(role) WHERE role='owner' AND status='active' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS operator_login_challenges (
 challenge_id TEXT NOT NULL PRIMARY KEY,
 email_normalized TEXT NOT NULL,
 otp_hmac TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('bootstrap','login')),
 expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 consumed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_operator_challenges_email
 ON operator_login_challenges(email_normalized,created_at);

CREATE TABLE IF NOT EXISTS operator_sessions (
 session_id TEXT NOT NULL PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
 token_sha256 TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_account
 ON operator_sessions(account_id,expires_at);

CREATE TABLE IF NOT EXISTS operator_access_audit (
 audit_id TEXT NOT NULL PRIMARY KEY,
 account_id TEXT REFERENCES accounts(account_id) ON DELETE RESTRICT,
 event_type TEXT NOT NULL CHECK(event_type IN (
   'owner_enrolled','operator_login','operator_logout','operator_action'
 )),
 operation TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_operator_audit_account
 ON operator_access_audit(account_id,created_at);
