PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_clients (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  identification TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#edc773',
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_cases (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES portal_stages(id),
  title TEXT NOT NULL,
  reference TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES portal_cases(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'expired')),
  unsigned_key TEXT NOT NULL,
  signed_key TEXT,
  signing_token_hash TEXT NOT NULL UNIQUE,
  signer_name TEXT,
  signer_identification TEXT,
  signer_email TEXT,
  signed_at TEXT,
  pdf_hash TEXT,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES portal_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_audit (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES portal_documents(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES portal_users(id),
  event TEXT NOT NULL,
  detail TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_files (
  key TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  content_type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_token ON portal_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_cases_stage ON portal_cases(stage_id);
CREATE INDEX IF NOT EXISTS idx_portal_documents_case ON portal_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_portal_documents_token ON portal_documents(signing_token_hash);

INSERT OR IGNORE INTO portal_stages (id, name, color, position, active, created_at, updated_at) VALUES
  ('stage-intake', 'Consulta inicial', '#5b8def', 1, 1, datetime('now'), datetime('now')),
  ('stage-review', 'En revisión', '#edc773', 2, 1, datetime('now'), datetime('now')),
  ('stage-docs', 'Documentación', '#9b7ede', 3, 1, datetime('now'), datetime('now')),
  ('stage-active', 'En trámite', '#42a98b', 4, 1, datetime('now'), datetime('now')),
  ('stage-waiting', 'Pendiente del cliente', '#e58b55', 5, 1, datetime('now'), datetime('now')),
  ('stage-closed', 'Finalizado', '#64748b', 6, 1, datetime('now'), datetime('now'));
