-- 1. Create tax_rates table
CREATE TABLE IF NOT EXISTS tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  rate numeric(15,4) NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_tax_rates_business ON tax_rates(business_id);

-- 2. Create function to seed defaults for a business
CREATE OR REPLACE FUNCTION seed_default_taxes(p_business_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO tax_rates (business_id, name, code, rate, is_default)
  VALUES 
    (p_business_id, 'VAT 18%', '01', 0.18, true),
    (p_business_id, 'Zero Rated', '02', 0, false),
    (p_business_id, 'Exempt', '03', 0, false),
    (p_business_id, 'Out of Scope', '11', 0, false)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 3. Seed existing businesses
SELECT seed_default_taxes(id) FROM businesses;

-- 4. Enable RLS
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

-- 5. Add Policies
DROP POLICY IF EXISTS "Businesses can manage their own tax rates" ON tax_rates;
CREATE POLICY "Businesses can manage their own tax rates" ON tax_rates
  FOR ALL
  TO authenticated
  USING (business_id = (SELECT business_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (business_id = (SELECT business_id FROM profiles WHERE id = auth.uid()));
