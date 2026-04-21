-- Add country column to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS country text;

-- Update existing businesses to default to Uganda (the core market)
UPDATE businesses SET country = 'Uganda' WHERE country IS NULL;
