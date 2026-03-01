-- ============================================================
-- YourBooks Lite — Admin, AVCO & Role Fixes Migration
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

-- ─── 1. Missing columns ─────────────────────────────────────

-- Products: cost_price for backwards compat
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;

-- Sales: discount + EFRIS fields the code writes during fiscalization
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS efris_response JSONB;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS buyer_type TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_tin TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS efris_payment_code TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS efris_fiscalized_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id UUID;

-- Sale items: per-item discount
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) DEFAULT 0;

-- Purchases: created_by + EFRIS fields
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_tin TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS efris_submitted BOOLEAN DEFAULT false;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS efris_submitted_at TIMESTAMPTZ;


-- ─── 1b. generate_invoice_number RPC ────────────────────────
-- Returns a sequential invoice number like INV-000001
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
BEGIN
  RETURN 'INV-' || LPAD(nextval('invoice_number_seq')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 2. increment_inventory RPC with proper AVCO ────────────
-- This atomically:
--   a) Upserts the inventory row
--   b) Computes weighted average cost:
--      new_avg = (old_qty × old_avg + new_qty × new_cost) / (old_qty + new_qty)
--   c) Handles first-time product-in-branch (INSERT) vs existing (UPDATE)

CREATE OR REPLACE FUNCTION increment_inventory(
  p_branch_id UUID,
  p_product_id UUID,
  p_quantity INT,
  p_unit_cost NUMERIC DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_current_qty INT;
  v_current_avg NUMERIC;
  v_new_qty INT;
  v_new_avg NUMERIC;
BEGIN
  -- Lock and read current row
  SELECT quantity, avg_cost_price
  INTO v_current_qty, v_current_avg
  FROM inventory
  WHERE branch_id = p_branch_id AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- First time this product in this branch — insert
    INSERT INTO inventory (branch_id, product_id, quantity, avg_cost_price, updated_at)
    VALUES (p_branch_id, p_product_id, p_quantity, COALESCE(p_unit_cost, 0), now());
  ELSE
    v_new_qty := COALESCE(v_current_qty, 0) + p_quantity;

    IF p_unit_cost IS NOT NULL AND v_new_qty > 0 THEN
      -- AVCO weighted average
      v_new_avg := (
        (COALESCE(v_current_qty, 0) * COALESCE(v_current_avg, 0))
        + (p_quantity * p_unit_cost)
      ) / v_new_qty;
    ELSE
      -- No cost provided, keep existing average
      v_new_avg := COALESCE(v_current_avg, 0);
    END IF;

    UPDATE inventory
    SET quantity = v_new_qty,
        avg_cost_price = ROUND(v_new_avg, 2),
        updated_at = now()
    WHERE branch_id = p_branch_id AND product_id = p_product_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 3. decrement_inventory (for sales) ─────────────────────
-- Reduces stock by quantity, does NOT change avg_cost_price
-- Returns the current avg_cost_price (to snapshot into sale_items.cost_price)

DROP FUNCTION IF EXISTS decrement_inventory(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION decrement_inventory(
  p_branch_id UUID,
  p_product_id UUID,
  p_quantity INT
) RETURNS NUMERIC AS $$
DECLARE
  v_avg NUMERIC;
BEGIN
  UPDATE inventory
  SET quantity = GREATEST(quantity - p_quantity, 0),
      updated_at = now()
  WHERE branch_id = p_branch_id AND product_id = p_product_id
  RETURNING avg_cost_price INTO v_avg;

  RETURN COALESCE(v_avg, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 4. Fix Profiles RLS: Admin can manage team ─────────────
-- Existing: "Users can view own profile" (auth.uid() = id)
-- Problem: admin can't see or update other users
-- RLS policies are OR'd, so adding new ones doesn't break existing
-- IMPORTANT: We use SECURITY DEFINER functions to avoid infinite
-- recursion (a policy on profiles cannot subquery profiles directly)

CREATE OR REPLACE FUNCTION get_my_business_id()
RETURNS UUID AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Allow all business members to see team profiles (names, roles)
DROP POLICY IF EXISTS "Users can view business profiles" ON profiles;
CREATE POLICY "Users can view business profiles"
  ON profiles FOR SELECT
  USING (
    business_id = get_my_business_id()
  );

-- Admin can update any profile in their business
DROP POLICY IF EXISTS "Admin can update business profiles" ON profiles;
CREATE POLICY "Admin can update business profiles"
  ON profiles FOR UPDATE
  USING (
    business_id = get_my_business_id()
    AND get_my_role() = 'admin'
  );

-- Admin can insert profiles (for inviting new users)
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
CREATE POLICY "Admin can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_role() = 'admin'
  );

-- Admin can delete profiles (remove users from business)
DROP POLICY IF EXISTS "Admin can delete profiles" ON profiles;
CREATE POLICY "Admin can delete profiles"
  ON profiles FOR DELETE
  USING (
    business_id = get_my_business_id()
    AND get_my_role() = 'admin'
  );


-- ─── 5. Allow salesperson to update inventory on sale ────────
-- (decrement stock when selling)
DROP POLICY IF EXISTS "Salespersons can update inventory on sale" ON inventory;
CREATE POLICY "Salespersons can update inventory on sale"
  ON inventory FOR UPDATE
  USING (
    branch_id IN (
      SELECT b.id FROM branches b
      JOIN profiles p ON p.business_id = b.business_id
      WHERE p.id = auth.uid()
    )
  );


-- ─── 6. Allow all roles to insert inventory (via RPC) ───────
DROP POLICY IF EXISTS "Business users can insert inventory" ON inventory;
CREATE POLICY "Business users can insert inventory"
  ON inventory FOR INSERT
  WITH CHECK (
    branch_id IN (
      SELECT b.id FROM branches b
      JOIN profiles p ON p.business_id = b.business_id
      WHERE p.id = auth.uid()
    )
  );


-- ─── 7. Sales update policy (for fiscalization etc.) ────────
DROP POLICY IF EXISTS "Users can update own sales" ON sales;
CREATE POLICY "Users can update own sales"
  ON sales FOR UPDATE
  USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );


-- ─── 8. Purchases update policy (for EFRIS status) ──────────
DROP POLICY IF EXISTS "Users can update purchases" ON purchases;
CREATE POLICY "Users can update purchases"
  ON purchases FOR UPDATE
  USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );


-- ─── 9. Businesses update (for EFRIS config, app_mode) ──────
DROP POLICY IF EXISTS "Admin can update business" ON businesses;
CREATE POLICY "Admin can update business"
  ON businesses FOR UPDATE
  USING (
    id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );


-- ─── 10. EFRIS fields on businesses ─────────────────────────
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS efris_api_key TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS efris_api_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS efris_test_mode BOOLEAN DEFAULT true;


-- ============================================================
-- DONE — Run this migration in Supabase SQL Editor
-- ============================================================
