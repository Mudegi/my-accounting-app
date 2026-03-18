-- Sales Type Migration
-- Adds sales_type column to profiles to distinguish in-store vs field salespersons
-- Run this in Supabase SQL Editor

-- Add column with default 'in_store' for existing users
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sales_type text NOT NULL DEFAULT 'in_store'
CHECK (sales_type IN ('in_store', 'field', 'both'));

-- Update admins and branch managers to 'both' since they can do everything
UPDATE profiles
SET sales_type = 'both'
WHERE role IN ('admin', 'branch_manager');
