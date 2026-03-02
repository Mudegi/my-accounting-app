-- ════════════════════════════════════════════════════════════
-- ACCOUNTS PAYABLE MIGRATION
-- Run in Supabase SQL Editor
-- Fixes: Credit purchases tracking, supplier payables, supplier payments
-- ════════════════════════════════════════════════════════════

-- ─── 1. ADD COLUMNS TO PURCHASES TABLE ────
-- payment_method: how the purchase was paid (cash, mobile_money, bank, credit)
-- supplier_id: FK to suppliers table for linking
-- status: paid / unpaid / partial
-- paid_amount: how much has been paid against a credit purchase

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash'
  CHECK (payment_method IN ('cash','mobile_money','card','bank','credit'));

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'paid'
  CHECK (status IN ('paid','unpaid','partial'));

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;

-- Back-fill existing purchases: all existing are considered 'paid' in cash
UPDATE purchases SET payment_method = 'cash', status = 'paid', paid_amount = total_amount
WHERE payment_method IS NULL OR status IS NULL;


-- ─── 2. SUPPLIER PAYMENTS TABLE (mirrors debt_payments for payables) ────
CREATE TABLE IF NOT EXISTS supplier_payments (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id   UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  supplier_id   UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','mobile_money','card','bank')),
  note          TEXT,
  paid_by       UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_payments_select" ON supplier_payments FOR SELECT
  USING (business_id = get_my_business_id());
CREATE POLICY "supplier_payments_insert" ON supplier_payments FOR INSERT
  WITH CHECK (business_id = get_my_business_id());
CREATE POLICY "supplier_payments_update" ON supplier_payments FOR UPDATE
  USING (business_id = get_my_business_id());
CREATE POLICY "supplier_payments_delete" ON supplier_payments FOR DELETE
  USING (business_id = get_my_business_id() AND get_my_role() = 'admin');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON supplier_payments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_business ON supplier_payments(business_id);

-- Index on purchases for fast credit lookups
CREATE INDEX IF NOT EXISTS idx_purchases_payment_method ON purchases(payment_method);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
