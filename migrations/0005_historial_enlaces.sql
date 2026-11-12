CREATE TABLE IF NOT EXISTS portal_document_links (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES portal_documents(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES portal_users(id),
  revoked_at TEXT,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_document_links_document ON portal_document_links(document_id, created_at DESC);

INSERT OR IGNORE INTO portal_document_links (id,document_id,token,token_hash,expires_at,created_at,created_by,used_at)
SELECT 'link-' || id,id,signing_token,signing_token_hash,expires_at,created_at,created_by,signed_at
FROM portal_documents
WHERE signing_token IS NOT NULL;
