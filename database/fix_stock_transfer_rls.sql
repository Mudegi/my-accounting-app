-- ============================================
-- Fix: Stock Transfer Update Policy
-- ============================================

-- Allow users to update stock transfers in their own business
-- This is required for confirming receipt (setting status to 'received')
CREATE POLICY "Users can update own transfers"
  ON stock_transfers FOR UPDATE
  USING (
    business_id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid()
    )
  );
