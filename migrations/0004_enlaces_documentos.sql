ALTER TABLE portal_documents ADD COLUMN signing_token TEXT;

CREATE INDEX IF NOT EXISTS idx_portal_documents_status ON portal_documents(status);
