-- 1. Update purchases table
ALTER TABLE purchases 
ADD COLUMN IF NOT EXISTS subtotal_amount numeric(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS vat_amount numeric(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS purchase_date date DEFAULT CURRENT_DATE;

-- 2. Update purchase_items table
ALTER TABLE purchase_items
ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax_amount numeric(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax_category_code text;

-- 3. Update existing records (estimate 18% if vat_amount was intended but not split)
-- This is optional but keeps data consistent
UPDATE purchases SET subtotal_amount = total_amount WHERE subtotal_amount = 0;
UPDATE purchase_items SET tax_rate = 18, tax_amount = ROUND((line_total * 0.18 / 1.18)::numeric, 2), tax_category_code = '01' 
WHERE tax_category_code IS NULL AND EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id AND p.vat_amount > 0);
