ALTER TABLE portal_clients ADD COLUMN identification_key TEXT;
ALTER TABLE portal_cases ADD COLUMN reference_key TEXT;

UPDATE portal_clients
SET identification_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(identification), '.', ''), '-', ''), ' ', ''), '/', ''), '\', ''))
WHERE TRIM(COALESCE(identification, '')) <> '';

UPDATE portal_cases
SET reference_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(reference), '.', ''), '-', ''), ' ', ''), '/', ''), '\', ''))
WHERE TRIM(COALESCE(reference, '')) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_clients_identification_key
ON portal_clients(identification_key)
WHERE identification_key IS NOT NULL AND identification_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_cases_reference_key
ON portal_cases(reference_key)
WHERE reference_key IS NOT NULL AND reference_key <> '';
