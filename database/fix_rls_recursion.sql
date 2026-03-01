-- ============================================================
-- FIX: Infinite recursion in profiles RLS policies
-- The "Users can view business profiles" policy queries
-- profiles inside its own RLS check → infinite loop.
-- Fix: use SECURITY DEFINER helper functions that bypass RLS.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- ─── Step 1: Drop the broken policies on profiles ────────────
DROP POLICY IF EXISTS "Users can view business profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can update business profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON profiles;

-- ─── Step 2: Helper functions (SECURITY DEFINER = bypass RLS) ─
CREATE OR REPLACE FUNCTION get_my_business_id()
RETURNS UUID AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Step 3: Recreate profiles policies using the helpers ────

-- All business members can see each other's profiles
CREATE POLICY "Users can view business profiles"
  ON profiles FOR SELECT
  USING (
    business_id = get_my_business_id()
  );

-- Admin can update any profile in their business
CREATE POLICY "Admin can update business profiles"
  ON profiles FOR UPDATE
  USING (
    business_id = get_my_business_id()
    AND get_my_role() = 'admin'
  );

-- Admin can insert profiles (invite new users)
CREATE POLICY "Admin can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_role() = 'admin'
  );

-- Admin can delete profiles
CREATE POLICY "Admin can delete profiles"
  ON profiles FOR DELETE
  USING (
    business_id = get_my_business_id()
    AND get_my_role() = 'admin'
  );

-- ============================================================
-- DONE — Profile loading should work now.
-- ============================================================
