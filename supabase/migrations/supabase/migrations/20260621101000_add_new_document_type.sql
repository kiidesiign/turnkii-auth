-- Add document_type column to track which document
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'privacy';

-- Add a unique constraint to prevent duplicate entries per user per document
ALTER TABLE documents 
ADD CONSTRAINT unique_contact_document UNIQUE (contact_id, document_type);

ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE files DISABLE ROW LEVEL SECURITY;

ALTER TABLE documents ADD CONSTRAINT unique_contact_document_type UNIQUE (contact_id, document_type);

CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  account_name TEXT NULL,
  account_status TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)<
;

ALTER TABLE contacts ADD COLUMN account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE contacts ADD COLUMN role TEXT DEFAULT 'member' CHECK (role IN ('primary', 'member'));

CREATE TABLE document_types (
  name TEXT NOT NULL UNIQUE,  -- e.g., 'PASSPORT', 'NIE_APODERADO', 'DATA_POLICY'
  display_name TEXT NOT NULL,  -- e.g., 'Passport', 'NIE Representation Agreement', 'Data Policy Agreement'
  requires_signing BOOLEAN NOT NULL DEFAULT FALSE,
  created_on_signup BOOLEAN NOT NULL DEFAULT FALSE,
  file_template TEXT, -- optional, could store a filename or placeholder
  store_file_1D BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO document_types (name, display_name, requires_signing, created_on_signup, file_template, store_file_1D)
VALUES
  ('PASSPORT', 'Passport', TRUE, TRUE, '',TRUE),
  ('NIE_APODERADO', 'NIE Representation Agreement (Apoderado)', TRUE, TRUE, '',TRUE),
  ('DATA_POLICY', 'Privacy and Data Handling Agreement', TRUE, TRUE, '',TRUE);

-- 1. Drop the existing function if it already exists (to avoid conflicts)
DROP FUNCTION IF EXISTS create_initial_documents() CASCADE;

-- 2. Create the new function
CREATE OR REPLACE FUNCTION create_initial_documents()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO documents (contact_id, document_type, status, provider)
  SELECT NEW.id, dt.name, 'pending', NULL
  FROM document_types dt
  WHERE dt.created_on_signup = TRUE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach the trigger to the contacts table (drop old one if exists)
DROP TRIGGER IF EXISTS after_contact_insert ON contacts;
CREATE TRIGGER after_contact_insert
AFTER INSERT ON contacts
FOR EACH ROW
EXECUTE FUNCTION create_initial_documents();

-- 1. Create accounts table if it doesn't exist
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add account_id to contacts if missing
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE;

-- 3. Add role column if missing (optional but good)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member' CHECK (role IN ('primary', 'member'));

ALTER TABLE documents ALTER COLUMN file_name DROP NOT NULL;