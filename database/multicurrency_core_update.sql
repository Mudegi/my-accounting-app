-- ═══════════════════════════════════════════════════════════════
-- Multi-Currency Core Data Extensions
-- Adds exchange rates and base-currency equivalents to transactions
-- ═══════════════════════════════════════════════════════════════

-- 1) SALES: Add exchange rate and base equivalent
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'exchange_rate') THEN
    ALTER TABLE sales ADD COLUMN exchange_rate numeric(18,8) DEFAULT 1;
    ALTER TABLE sales ADD COLUMN base_total numeric(15,2);
  END IF;
END $$;

-- 2) PURCHASES: Add exchange rate and base equivalent
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'exchange_rate') THEN
    ALTER TABLE purchases ADD COLUMN exchange_rate numeric(18,8) DEFAULT 1;
    ALTER TABLE purchases ADD COLUMN base_total numeric(15,2);
  END IF;
END $$;

-- 3) EXPENSES: Add exchange rate and base equivalent
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'exchange_rate') THEN
    ALTER TABLE expenses ADD COLUMN exchange_rate numeric(18,8) DEFAULT 1;
    ALTER TABLE expenses ADD COLUMN base_total numeric(15,2);
  END IF;
END $$;

-- 4) JOURNAL ENTRIES: Add currency tracking to the header
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_entries' AND column_name = 'currency_code') THEN
    ALTER TABLE journal_entries ADD COLUMN currency_code text DEFAULT 'UGX' REFERENCES currencies(code);
    ALTER TABLE journal_entries ADD COLUMN exchange_rate numeric(18,8) DEFAULT 1;
  END IF;
END $$;

-- 5) JOURNAL ENTRY LINES: Add base currency equivalents for multi-currency reporting
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_entry_lines' AND column_name = 'base_debit') THEN
    ALTER TABLE journal_entry_lines ADD COLUMN base_debit numeric(15,2);
    ALTER TABLE journal_entry_lines ADD COLUMN base_credit numeric(15,2);
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_base_total ON sales(base_total);
CREATE INDEX IF NOT EXISTS idx_jel_base_debit ON journal_entry_lines(base_debit);
CREATE INDEX IF NOT EXISTS idx_jel_base_credit ON journal_entry_lines(base_credit);

-- Update existing records: default base_debit/base_credit to current debit/credit
UPDATE journal_entry_lines SET base_debit = debit, base_credit = credit WHERE base_debit IS NULL;
UPDATE sales SET base_total = total_amount WHERE base_total IS NULL;
UPDATE purchases SET base_total = total_amount WHERE base_total IS NULL;
UPDATE expenses SET base_total = amount WHERE base_total IS NULL;
