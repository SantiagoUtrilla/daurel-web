-- DAUREL V2 / 0007: autorización previa de correos para colaboradores.
-- ÚNICAMENTE en daurel-staging; nunca en daurel-db (producción).
-- Necesaria porque account_emails.verified_at es NOT NULL.
-- Autorizar un correo NO equivale a verificarlo: el email se agrega a
-- account_emails solo tras demostrar posesión con un código OTP auténtico.
CREATE TABLE IF NOT EXISTS operator_approved_emails (
  email_normalized TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(account_id) ON DELETE RESTRICT,
  approved_by_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_operator_approvals_owner
  ON operator_approved_emails(approved_by_account_id,approved_at);

-- La asignación por expediente es EXPLÍCITA. El rol global no abre todos
-- los expedientes a un colaborador. El propietario puede verlos todos.
CREATE TABLE IF NOT EXISTS operator_case_assignments (
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  assigned_by_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY(account_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_operator_case_assignments_request
  ON operator_case_assignments(request_id,revoked_at);
