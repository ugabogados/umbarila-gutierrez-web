CREATE TRIGGER IF NOT EXISTS require_portal_client_identification_key_insert
BEFORE INSERT ON portal_clients
WHEN TRIM(COALESCE(NEW.identification, '')) = '' OR TRIM(COALESCE(NEW.identification_key, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'client identification key required');
END;

CREATE TRIGGER IF NOT EXISTS require_portal_client_identification_key_update
BEFORE UPDATE OF identification, identification_key ON portal_clients
WHEN TRIM(COALESCE(NEW.identification, '')) = '' OR TRIM(COALESCE(NEW.identification_key, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'client identification key required');
END;

CREATE TRIGGER IF NOT EXISTS require_portal_case_reference_key_insert
BEFORE INSERT ON portal_cases
WHEN TRIM(COALESCE(NEW.reference, '')) = '' OR TRIM(COALESCE(NEW.reference_key, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'case reference key required');
END;

CREATE TRIGGER IF NOT EXISTS require_portal_case_reference_key_update
BEFORE UPDATE OF reference, reference_key ON portal_cases
WHEN TRIM(COALESCE(NEW.reference, '')) = '' OR TRIM(COALESCE(NEW.reference_key, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'case reference key required');
END;
