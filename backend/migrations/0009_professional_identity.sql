-- DAUREL V2 | 0009 | Identificación del profesionista y lista de incorporación
-- SOLO para la base de datos ficticia daurel-staging.
-- NO ejecutar en daurel-db (producción).
-- La tabla de nombres no almacena INE, cédula, firmas, imágenes o contratos.
-- Estos documentos requerirán una solución de almacenamiento privado aparte.
CREATE TABLE IF NOT EXISTS operator_professional_identities (
  account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts(account_id) ON DELETE RESTRICT,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 3 AND 120),
  updated_by_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operator_professional_requirements (
  account_id TEXT NOT NULL REFERENCES operator_professional_identities(account_id) ON DELETE RESTRICT,
  requirement_code TEXT NOT NULL CHECK (requirement_code IN (
    'professional_license','identity_check','contract','terms','privacy_notice'
  )),
  status TEXT NOT NULL DEFAULT 'not_collected' CHECK (status IN (
    'not_collected','pending_review','approved','rejected'
  )),
  reviewed_at TEXT,
  reviewed_by_account_id TEXT REFERENCES accounts(account_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id,requirement_code),
  CHECK (status <> 'approved' OR (reviewed_at IS NOT NULL AND reviewed_by_account_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_professional_requirement_review
  ON operator_professional_requirements(requirement_code,status);
