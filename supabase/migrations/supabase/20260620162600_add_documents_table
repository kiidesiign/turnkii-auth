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