-- ============================================
-- Accounting Fixes: Stock Transfers & AVCO
-- ============================================

-- 1. Add unit_cost to stock transfer items for permanent tracking
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS unit_cost numeric(15,2) DEFAULT 0;

-- 2. Seed the Stock Transfers clearing account (code 6400) if it doesn't exist
-- This logic ensures the account is available for all businesses
DO $$
DECLARE
    biz_id UUID;
BEGIN
    FOR biz_id IN SELECT id FROM businesses LOOP
        INSERT INTO accounts (business_id, code, name, account_type, is_system, description)
        VALUES (biz_id, '6400', 'Stock Transfers', 'expense', true, 'Clearing account for in-transit stock value')
        ON CONFLICT (business_id, code) DO NOTHING;
    END LOOP;
END;
$$;
