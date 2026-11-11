-- DAUREL V2 / 0004 · Agenda de pendientes y semáforo (SOLO daurel-staging).
-- No ejecutar en daurel-db (producción). Datos sintéticos únicamente.
-- Aplicar manualmente en D1 Studio; NO usar Wrangler migrations apply
-- hasta conciliar historial d1_migrations de 0001-0003.

CREATE TABLE IF NOT EXISTS followup_tasks (
  task_id TEXT NOT NULL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(request_id) ON DELETE RESTRICT,
  action_code TEXT NOT NULL CHECK (action_code IN (
    'contact_again','request_documents','review_documents','arrange_appointment',
    'followup_authority','update_client','review_response','check_deadline'
  )),
  due_date TEXT NOT NULL CHECK (due_date GLOB '????-??-??' AND length(due_date)=10),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','completed','cancelled')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, action_code, due_date)
);

CREATE INDEX IF NOT EXISTS idx_followup_tasks_due
  ON followup_tasks(status,due_date);

CREATE INDEX IF NOT EXISTS idx_followup_tasks_request
  ON followup_tasks(request_id,status,due_date);
