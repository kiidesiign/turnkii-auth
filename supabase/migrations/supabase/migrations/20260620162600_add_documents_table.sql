CREATE TABLE IF NOT EXISTS documents (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT, -- OneDrive or Supabase Storage URL
  file_id TEXT, -- OneDrive file ID
  signed_url TEXT, -- URL of the signed document
  zoho_request_id TEXT, -- Zoho Sign request ID
  status TEXT DEFAULT 'pending', -- pending, sent, signed, expired, cancelled
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for faster lookups
CREATE INDEX idx_documents_contact_id ON documents(contact_id);
CREATE INDEX idx_documents_zoho_request_id ON documents(zoho_request_id);

-- Add missing columns to documents table
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'signforge';

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'privacy';

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS provider_request_id TEXT;

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

-- Ensure other required columns exist
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_name TEXT;

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_url TEXT;

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_id TEXT;

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS signed_url TEXT;

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add foreign key constraint if missing
ALTER TABLE documents 
ADD CONSTRAINT fk_documents_contact 
FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_contact_id ON documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_provider_request_id ON documents(provider_request_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);