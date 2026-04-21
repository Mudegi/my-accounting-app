-- Add receipt_footer column to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS receipt_footer text;
