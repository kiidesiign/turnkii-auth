-- Add document_type column to track which document
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'privacy';

-- Add a unique constraint to prevent duplicate entries per user per document
ALTER TABLE documents 
ADD CONSTRAINT unique_contact_document UNIQUE (contact_id, document_type);