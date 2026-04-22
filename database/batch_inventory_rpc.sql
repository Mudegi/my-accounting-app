
-- Create a batch inventory decrement function to speed up POS checkout
CREATE OR REPLACE FUNCTION decrement_inventory_batch(
  p_branch_id UUID,
  p_items JSONB -- Array of {product_id: UUID, quantity: NUMERIC}
)
RETURNS JSONB -- Returns array of {product_id: UUID, avco: NUMERIC}
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
  v_avco NUMERIC;
  v_results JSONB := '[]'::JSONB;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity NUMERIC)
  LOOP
    UPDATE inventory
    SET quantity = GREATEST(COALESCE(quantity, 0) - v_item.quantity, 0),
        updated_at = now()
    WHERE branch_id = p_branch_id AND product_id = v_item.product_id
    RETURNING avg_cost_price INTO v_avco;

    v_results := v_results || jsonb_build_object(
      'product_id', v_item.product_id,
      'avco', COALESCE(v_avco, 0)
    );
  END LOOP;

  RETURN v_results;
END;
$$;
