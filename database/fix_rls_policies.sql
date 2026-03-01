-- ============================================
-- FIX: Missing RLS Policies
-- Run this in Supabase SQL Editor
-- This adds UPDATE policies that were missing
-- ============================================

-- BUSINESSES: Admins can update their own business (settings, EFRIS config, etc.)
CREATE POLICY "Admins can update own business"
  ON businesses FOR UPDATE
  USING (id IN (
    SELECT business_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- BRANCHES: Admins can update branches
CREATE POLICY "Admins can update branches"
  ON branches FOR UPDATE
  USING (business_id IN (
    SELECT business_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- SALES: Users can update sales in their business (for fiscalization, invoice numbers, etc.)
CREATE POLICY "Users can update sales"
  ON sales FOR UPDATE
  USING (business_id IN (
    SELECT business_id FROM profiles WHERE id = auth.uid()
  ));

-- PURCHASES: Managers can update purchases (for EFRIS submission status)
CREATE POLICY "Managers can update purchases"
  ON purchases FOR UPDATE
  USING (business_id IN (
    SELECT business_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'branch_manager')
  ));

-- CREDIT NOTES: Add INSERT policy (the EFRIS migration only added SELECT via "Business isolation")
CREATE POLICY "Users can insert credit notes"
  ON credit_notes FOR INSERT
  WITH CHECK (business_id IN (
    SELECT business_id FROM profiles WHERE id = auth.uid()
  ));

-- CREDIT NOTES: Users can update credit notes (for EFRIS submission status)
CREATE POLICY "Users can update credit notes"
  ON credit_notes FOR UPDATE
  USING (business_id IN (
    SELECT business_id FROM profiles WHERE id = auth.uid()
  ));

-- CREDIT NOTE ITEMS: Add INSERT policy
CREATE POLICY "Users can insert credit note items"
  ON credit_note_items FOR INSERT
  WITH CHECK (credit_note_id IN (
    SELECT id FROM credit_notes WHERE business_id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid()
    )
  ));
