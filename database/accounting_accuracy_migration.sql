-- Migration to support Fiscal Year settings and Accounting Accuracy
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS fiscal_year_start_month integer DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12);

-- Comment: 1 = January, 2 = February, ..., 12 = December
-- This allows each business admin to define their own reporting year.
