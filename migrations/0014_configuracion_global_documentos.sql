CREATE TABLE IF NOT EXISTS portal_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES portal_users(id)
);

UPDATE portal_templates SET background_key = NULL WHERE background_key IS NOT NULL;
