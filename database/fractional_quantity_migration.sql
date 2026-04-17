-- ============================================
-- Fractional Quantities Migration
-- Converting all quantity columns from INT to NUMERIC
-- Supporting up to 3 decimal places (e.g. 0.555 kg)
-- ============================================

-- 1. Table Column Conversions
ALTER TABLE inventory ALTER COLUMN quantity TYPE NUMERIC(15,3);
ALTER TABLE inventory ALTER COLUMN reorder_level TYPE NUMERIC(15,3);

ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(15,3);
ALTER TABLE purchase_items ALTER COLUMN quantity TYPE NUMERIC(15,3);
ALTER TABLE stock_transfer_items ALTER COLUMN quantity TYPE NUMERIC(15,3);

-- Field Sales Assignments (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'field_stock_assignments') THEN
        ALTER TABLE field_stock_assignments ALTER COLUMN qty_assigned TYPE NUMERIC(15,3);
        ALTER TABLE field_stock_assignments ALTER COLUMN qty_returned TYPE NUMERIC(15,3);
    END IF;
END $$;

-- 2. Update decrement_inventory RPC (sales)
-- Accepting numeric for p_quantity
CREATE OR REPLACE FUNCTION decrement_inventory(
  p_branch_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC
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

-- 3. Update increment_inventory RPC (purchases/onboarding)
-- Accepting numeric for p_quantity
CREATE OR REPLACE FUNCTION increment_inventory(
  p_branch_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_current_qty NUMERIC;
  v_current_avg NUMERIC;
  v_new_qty NUMERIC;
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
