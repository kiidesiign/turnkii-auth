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