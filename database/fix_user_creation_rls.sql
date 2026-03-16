-- ============================================
-- Fix: User Creation RLS Policy
-- ============================================

-- Add policy to allow admins to insert profiles for their own business
-- This is required because handleInvite manually inserts the profile after signUp
CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Also ensure admins can delete profiles (for soft delete/permanent removal if needed)
CREATE POLICY "Admins can delete profiles"
  ON profiles FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );
