-- ═══════════════════════════════════════════════════════════════
-- COMPLETE Accounting Module Migration (All-in-One)
-- Creates tables, indexes, RLS policies, and seeds accounts
-- Safe to run multiple times (uses IF NOT EXISTS / ON CONFLICT)
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────
-- 1) CREATE TABLES
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid REFERENCES accounts(id),
  is_system boolean DEFAULT false,
  is_active boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_type text,
  reference_id uuid,
  description text NOT NULL,
  is_auto boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id),
  debit numeric(15,2) DEFAULT 0,
  credit numeric(15,2) DEFAULT 0,
  description text,
  created_at timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────
-- 2) INDEXES (safe — CREATE INDEX IF NOT EXISTS)
-- ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_accounts_business ON accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_business ON journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_ref ON journal_entries(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_entry_lines(account_id);

-- ────────────────────────────────────────────────
-- 3) RLS — uses get_my_business_id() / get_my_role()
--    (these SECURITY DEFINER helpers were created in
--     fix_rls_recursion.sql — they avoid profiles recursion)
-- ────────────────────────────────────────────────

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;

-- Drop any old policies first (safe if they don't exist)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own accounts" ON accounts;
  DROP POLICY IF EXISTS "Admins can insert accounts" ON accounts;
  DROP POLICY IF EXISTS "Admins can update accounts" ON accounts;
  DROP POLICY IF EXISTS "Users can view journal entries" ON journal_entries;
  DROP POLICY IF EXISTS "Users can insert journal entries" ON journal_entries;
  DROP POLICY IF EXISTS "Users can view journal lines" ON journal_entry_lines;
  DROP POLICY IF EXISTS "Users can insert journal lines" ON journal_entry_lines;
END $$;

-- accounts
CREATE POLICY "Users can view own accounts" ON accounts FOR SELECT
  USING (business_id = get_my_business_id());

CREATE POLICY "Admins can insert accounts" ON accounts FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

CREATE POLICY "Admins can update accounts" ON accounts FOR UPDATE
  USING (business_id = get_my_business_id());

-- journal_entries
CREATE POLICY "Users can view journal entries" ON journal_entries FOR SELECT
  USING (business_id = get_my_business_id());

CREATE POLICY "Users can insert journal entries" ON journal_entries FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- journal_entry_lines  (join through journal_entries)
CREATE POLICY "Users can view journal lines" ON journal_entry_lines FOR SELECT
  USING (journal_entry_id IN (
    SELECT id FROM journal_entries WHERE business_id = get_my_business_id()
  ));

CREATE POLICY "Users can insert journal lines" ON journal_entry_lines FOR INSERT
  WITH CHECK (journal_entry_id IN (
    SELECT id FROM journal_entries WHERE business_id = get_my_business_id()
  ));

-- ────────────────────────────────────────────────
-- 4) SEED FUNCTION — creates all standard accounts
--    Uses ON CONFLICT DO NOTHING for idempotency
--    SECURITY DEFINER so it works from client-side RPC
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- ASSETS (1xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '1000', 'Cash', 'asset', true, 'Physical cash on hand'),
    (p_business_id, '1010', 'Mobile Money', 'asset', true, 'MTN MoMo, Airtel Money'),
    (p_business_id, '1020', 'Bank Account', 'asset', true, 'Business bank account'),
    (p_business_id, '1100', 'Accounts Receivable', 'asset', true, 'Money owed by customers'),
    (p_business_id, '1200', 'Inventory', 'asset', true, 'Stock of goods for sale'),
    (p_business_id, '1300', 'Equipment', 'asset', true, 'Business equipment and fixtures'),
    (p_business_id, '1400', 'VAT Input', 'asset', true, 'VAT paid on purchases (claimable from URA)')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- LIABILITIES (2xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '2000', 'Accounts Payable', 'liability', true, 'Money owed to suppliers'),
    (p_business_id, '2100', 'VAT Payable', 'liability', true, 'VAT collected, owed to URA'),
    (p_business_id, '2200', 'Salaries Payable', 'liability', true, 'Unpaid employee wages'),
    (p_business_id, '2300', 'Loans Payable', 'liability', true, 'Outstanding loans')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- EQUITY (3xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '3000', 'Owner Equity', 'equity', true, 'Owner investment / capital'),
    (p_business_id, '3100', 'Retained Earnings', 'equity', true, 'Accumulated profits')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- REVENUE (4xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '4000', 'Sales Revenue', 'revenue', true, 'Income from product sales'),
    (p_business_id, '4100', 'Sales Discount', 'revenue', true, 'Discounts given to customers'),
    (p_business_id, '4200', 'Sales Returns', 'revenue', true, 'Credit notes / returns'),
    (p_business_id, '4300', 'Other Income', 'revenue', true, 'Miscellaneous income')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- EXPENSES (5xxx-6xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true, 'Direct cost of items sold'),
    (p_business_id, '5100', 'Purchase Expenses', 'expense', true, 'Cost of purchasing stock'),
    (p_business_id, '6000', 'Rent', 'expense', true, 'Shop / premises rent'),
    (p_business_id, '6010', 'Electricity', 'expense', true, 'UMEME / power bills'),
    (p_business_id, '6020', 'Water', 'expense', true, 'NWSC water bills'),
    (p_business_id, '6030', 'Transport', 'expense', true, 'Delivery, boda, fuel'),
    (p_business_id, '6040', 'Communication', 'expense', true, 'Airtime, data, internet'),
    (p_business_id, '6050', 'Salaries & Wages', 'expense', true, 'Employee compensation'),
    (p_business_id, '6060', 'Supplies', 'expense', true, 'Office and shop supplies'),
    (p_business_id, '6070', 'Repairs & Maintenance', 'expense', true, 'Equipment repairs'),
    (p_business_id, '6080', 'Insurance', 'expense', true, 'Business insurance'),
    (p_business_id, '6090', 'Bank Charges', 'expense', true, 'Bank fees'),
    (p_business_id, '6100', 'Taxes & Licenses', 'expense', true, 'Trading licenses, URA'),
    (p_business_id, '6200', 'Depreciation', 'expense', true, 'Asset depreciation'),
    (p_business_id, '6300', 'Miscellaneous Expense', 'expense', true, 'Other expenses')
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$;

-- ────────────────────────────────────────────────
-- 5) AUTO-SEED for all existing businesses
--    (adds any missing accounts including VAT Input 1400)
-- ────────────────────────────────────────────────

DO $$
DECLARE
  biz RECORD;
BEGIN
  FOR biz IN SELECT id FROM businesses LOOP
    PERFORM seed_chart_of_accounts(biz.id);
  END LOOP;
END;
$$;
