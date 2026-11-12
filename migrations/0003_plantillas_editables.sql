CREATE TABLE IF NOT EXISTS portal_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES portal_users(id)
);

ALTER TABLE portal_documents ADD COLUMN template_id TEXT REFERENCES portal_templates(id);
ALTER TABLE portal_documents ADD COLUMN template_name TEXT;
ALTER TABLE portal_documents ADD COLUMN content_snapshot TEXT;

CREATE INDEX IF NOT EXISTS idx_portal_documents_template ON portal_documents(template_id);
