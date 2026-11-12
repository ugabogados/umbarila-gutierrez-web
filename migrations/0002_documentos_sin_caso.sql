PRAGMA foreign_keys = OFF;

CREATE TABLE portal_documents_new (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES portal_cases(id) ON DELETE SET NULL,
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

INSERT INTO portal_documents_new SELECT * FROM portal_documents;
DROP TABLE portal_documents;
ALTER TABLE portal_documents_new RENAME TO portal_documents;

CREATE INDEX idx_portal_documents_case ON portal_documents(case_id);
CREATE INDEX idx_portal_documents_token ON portal_documents(signing_token_hash);

PRAGMA foreign_keys = ON;
