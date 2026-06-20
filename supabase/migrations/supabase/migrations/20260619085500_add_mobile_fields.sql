-- Add mobile_country_code and mobile_number columns
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS mobile_country_code TEXT;

ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS mobile_number TEXT;

-- Add generated mobile column (combines country code + number)
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS mobile TEXT 
GENERATED ALWAYS AS (mobile_country_code || mobile_number) STORED;

-- Update existing records with default country code
UPDATE contacts 
SET mobile_country_code = '+34' 
WHERE mobile_country_code IS NULL AND mobile_number IS NOT NULL;

-- Drop the legacy phone column (no longer used)
ALTER TABLE contacts 
DROP COLUMN IF EXISTS phone;