-- ============================================
-- REPAIR INVENTORY LOGIC
-- Run this in Supabase SQL Editor to fix stock reduction
-- ============================================

-- 1. DROP all potential overloads of the functions
-- This is necessary because INT and NUMERIC versions are different functions.
-- We MUST drop them explicitly before recreating to avoid shadowing.

DROP FUNCTION IF EXISTS decrement_inventory(UUID, UUID, INT);
DROP FUNCTION IF EXISTS decrement_inventory(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS increment_inventory(UUID, UUID, INT);
DROP FUNCTION IF EXISTS increment_inventory(UUID, UUID, INT, NUMERIC);
DROP FUNCTION IF EXISTS increment_inventory(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS increment_inventory(UUID, UUID, NUMERIC, NUMERIC);

-- 2. RECREATE decrement_inventory (Sales)
CREATE OR REPLACE FUNCTION decrement_inventory(
  p_branch_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_avg NUMERIC;
BEGIN
  UPDATE inventory
  SET quantity = GREATEST(COALESCE(quantity, 0) - p_quantity, 0),
      updated_at = now()
  WHERE branch_id = p_branch_id AND product_id = p_product_id
  RETURNING avg_cost_price INTO v_avg;

  -- Return the cost price so the POS can record it accurately
  RETURN COALESCE(v_avg, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RECREATE increment_inventory (Purchases)
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
  -- Lock the row to prevent race conditions during purchase
  SELECT quantity, avg_cost_price
  INTO v_current_qty, v_current_avg
  FROM inventory
  WHERE branch_id = p_branch_id AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- First time this product is entering this branch
    INSERT INTO inventory (branch_id, product_id, quantity, avg_cost_price, updated_at)
    VALUES (p_branch_id, p_product_id, p_quantity, COALESCE(p_unit_cost, 0), now());
  ELSE
    v_new_qty := COALESCE(v_current_qty, 0) + p_quantity;

    IF p_unit_cost IS NOT NULL AND v_new_qty > 0 THEN
      -- Weighted average cost (AVCO)
      v_new_avg := (
        (COALESCE(v_current_qty, 0) * COALESCE(v_current_avg, 0))
        + (p_quantity * p_unit_cost)
      ) / v_new_qty;
    ELSE
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
