ALTER TABLE portal_documents ADD COLUMN deleted_at TEXT;
ALTER TABLE portal_documents ADD COLUMN deleted_by TEXT REFERENCES portal_users(id);

CREATE INDEX IF NOT EXISTS idx_portal_documents_deleted ON portal_documents(deleted_at);
