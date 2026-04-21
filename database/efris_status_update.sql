-- ═══════════════════════════════════════════════════════════════════
-- EFRIS Status & Manual Submission Migration
-- Track submission states and allow for deferred fiscalization
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add columns to sales table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'efris_status'
  ) THEN
    ALTER TABLE sales ADD COLUMN efris_status text DEFAULT 'not_required' 
      CHECK (efris_status IN ('not_required', 'pending', 'submitted', 'failed'));
    ALTER TABLE sales ADD COLUMN efris_error text;
  END IF;
END $$;

-- 2. Initialize status based on current is_fiscalized flag
-- If it has an invoice number or was marked as fiscalized, it's 'submitted'
UPDATE sales 
SET efris_status = 'submitted' 
WHERE is_fiscalized = true OR invoice_number IS NOT NULL;

-- 3. Update efris_migration.sql (implicit) 
-- Ensure the generate_invoice_number function is robust
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  next_num INT;
BEGIN
  next_num := nextval('invoice_number_seq');
  RETURN 'INV-' || LPAD(next_num::text, 6, '0');
END;
$$;
