-- DAUREL V2 | 0008 | Capacidades declaradas del equipo
-- EJECUTAR SOLO EN LA BASE D1 DE PRUEBAS daurel-staging.
-- No ejecutar contra daurel-db (producción).
-- Tener especialidad declarada NO verifica título, cédula, matrícula ni habilita
-- la asignación automática. El propietario sigue concediendo permisos por expediente.
CREATE TABLE IF NOT EXISTS operator_professional_profiles (
  account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts(account_id) ON DELETE RESTRICT,
  availability TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (availability IN ('available','limited','unavailable')),
  capacity_limit INTEGER NOT NULL DEFAULT 3 CHECK (capacity_limit BETWEEN 1 AND 20),
  updated_by_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operator_professional_capabilities (
  account_id TEXT NOT NULL REFERENCES operator_professional_profiles(account_id) ON DELETE RESTRICT,
  specialty_code TEXT NOT NULL CHECK (specialty_code IN (
    'juridica_laboral','juridica_civil','juridica_marcas','contaduria',
    'arquitectura','ingenieria_civil'
  )),
  validation_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (validation_status IN ('unverified')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id,specialty_code)
);

CREATE INDEX IF NOT EXISTS idx_operator_capabilities_specialty
  ON operator_professional_capabilities(specialty_code,account_id);
