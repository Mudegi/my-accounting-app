-- ============================================
-- EFRIS Integration Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- Add EFRIS fields to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS efris_api_key text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS efris_api_url text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS efris_test_mode boolean DEFAULT true;

-- Add EFRIS fields to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS efris_product_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS efris_item_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS commodity_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS commodity_name text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS efris_unit_code text DEFAULT '109';
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_excise_tax boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS excise_duty_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS efris_registered_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_category_code text DEFAULT '01';

-- Add EFRIS fields to sales
ALTER TABLE sales ADD COLUMN IF NOT EXISTS buyer_type text DEFAULT '1';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_tin text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_address text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS efris_payment_code text DEFAULT '102';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS efris_fiscalized_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_number text;

-- Add EFRIS fields to purchases
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_tin text;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS efris_submitted boolean DEFAULT false;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS efris_submitted_at timestamptz;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stock_in_type text DEFAULT '102';

-- Create credit_notes table
CREATE TABLE IF NOT EXISTS credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES sales(id),
  credit_note_number text NOT NULL,
  reason text NOT NULL DEFAULT 'GOODS_RETURNED',
  customer_name text,
  customer_tin text,
  original_fdn text,
  original_invoice_number text,
  total_amount numeric(15,2) NOT NULL DEFAULT 0,
  efris_reference_no text,
  efris_verification_code text,
  efris_qr_code text,
  efris_submitted boolean DEFAULT false,
  efris_submitted_at timestamptz,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'submitted')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Credit note items
CREATE TABLE IF NOT EXISTS credit_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid REFERENCES credit_notes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  product_name text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  unit_price numeric(15,2) NOT NULL,
  tax_rate numeric(5,2) DEFAULT 0.18,
  line_total numeric(15,2) NOT NULL,
  commodity_code text,
  efris_item_code text,
  created_at timestamptz DEFAULT now()
);

-- RLS for credit_notes
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business isolation" ON credit_notes FOR ALL
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE credit_note_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Via credit note" ON credit_note_items FOR ALL
  USING (credit_note_id IN (SELECT id FROM credit_notes WHERE business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())));

-- Generate invoice numbers sequence
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number(p_business_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  next_num INT;
BEGIN
  next_num := nextval('invoice_number_seq');
  RETURN 'INV-' || LPAD(next_num::text, 6, '0');
END;
$$;
