-- Add new columns to contacts
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deactivated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS unsubscribed_notes TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_notes TEXT;

-- Drop the old trigger (it created documents on contact insert)
DROP TRIGGER IF EXISTS after_contact_insert ON contacts;
-- Optionally drop the function if no longer needed
DROP FUNCTION IF EXISTS create_initial_documents() CASCADE;

CREATE OR REPLACE FUNCTION create_initial_documents()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO documents (contact_id, document_type, status, provider, requires_signing)
  SELECT NEW.id, dt.name, 'pending', NULL, dt.requires_signing
  FROM document_types dt
  WHERE dt.created_on_signup = TRUE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Migration: Copy document_type fields into documents table
-- Date: 2026-06-22
-- Purpose: Snapshot key document type attributes at creation time
-- ============================================================

BEGIN;

-- 1. Add columns to documents if they don't exist
ALTER TABLE documents ADD COLUMN IF NOT EXISTS requires_signing BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS store_file_1d BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_template TEXT;

-- 2. Populate existing documents from document_types
UPDATE documents AS d
SET 
  requires_signing = dt.requires_signing,
  store_file_1d = dt.store_file_1d,
  display_name = dt.display_name,
  file_template = dt.file_template
FROM document_types AS dt
WHERE d.document_type = dt.name;

-- 3. Make columns NOT NULL where appropriate (after population)
ALTER TABLE documents ALTER COLUMN requires_signing SET NOT NULL;
ALTER TABLE documents ALTER COLUMN store_file_1d SET NOT NULL;
-- display_name and file_template can remain nullable

-- 4. Drop and recreate the trigger function to copy the fields
DROP FUNCTION IF EXISTS create_initial_documents() CASCADE;

CREATE OR REPLACE FUNCTION create_initial_documents()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO documents (
    contact_id,
    document_type,
    status,
    provider,
    requires_signing,
    store_file_1d,
    display_name,
    file_template
  )
  SELECT 
    NEW.id,
    dt.name,
    'pending',
    NULL,
    dt.requires_signing,
    dt.store_file_1d,
    dt.display_name,
    dt.file_template
  FROM document_types dt
  WHERE dt.created_on_signup = TRUE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Reattach the trigger
DROP TRIGGER IF EXISTS after_contact_insert ON contacts;
CREATE TRIGGER after_contact_insert
AFTER INSERT ON contacts
FOR EACH ROW
EXECUTE FUNCTION create_initial_documents();

-- 6. Ensure PASSPORT does not require signing (just in case)
UPDATE document_types SET requires_signing = false WHERE name = 'PASSPORT';

COMMIT;

DROP TRIGGER IF EXISTS after_contact_insert ON contacts;
DROP FUNCTION IF EXISTS create_initial_documents() CASCADE;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_web_url TEXT;