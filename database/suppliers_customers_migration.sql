-- ============================================================
-- YourBooks Lite — Suppliers & Customers Tables
-- Run in Supabase SQL Editor
-- ============================================================

-- ─── Suppliers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tin TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  contact_person TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own business suppliers" ON suppliers;
CREATE POLICY "Users can view own business suppliers"
  ON suppliers FOR SELECT
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own business suppliers" ON suppliers;
CREATE POLICY "Users can insert own business suppliers"
  ON suppliers FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own business suppliers" ON suppliers;
CREATE POLICY "Users can update own business suppliers"
  ON suppliers FOR UPDATE
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own business suppliers" ON suppliers;
CREATE POLICY "Users can delete own business suppliers"
  ON suppliers FOR DELETE
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

-- ─── Customers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tin TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  contact_person TEXT,
  buyer_type TEXT NOT NULL DEFAULT '1',  -- 0=B2B, 1=B2C, 2=Foreigner, 3=B2G
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own business customers" ON customers;
CREATE POLICY "Users can view own business customers"
  ON customers FOR SELECT
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own business customers" ON customers;
CREATE POLICY "Users can insert own business customers"
  ON customers FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own business customers" ON customers;
CREATE POLICY "Users can update own business customers"
  ON customers FOR UPDATE
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own business customers" ON customers;
CREATE POLICY "Users can delete own business customers"
  ON customers FOR DELETE
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

-- ─── Add supplier_id FK to purchases (optional link) ───────
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);

-- ─── Add missing columns to purchases ──────────────────────
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS total_cost NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ─── Add customer_id FK to sales (optional link) ───────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

-- ─── Add is_service flag to products (product vs service) ──
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;

-- ─── Add efris_response JSONB to sales (full EFRIS response for receipt) ──
ALTER TABLE sales ADD COLUMN IF NOT EXISTS efris_response JSONB;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) DEFAULT 0;

-- ─── Per-item discount support ─────────────────────────────
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) DEFAULT 0;
