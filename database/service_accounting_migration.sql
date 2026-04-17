-- ============================================
-- Service Accounting Migration
-- Separating Service Revenue and Cost of Services
-- ============================================

-- 1. Update the seed function for FUTURE businesses
CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- ASSETS (1xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '1000', 'Cash', 'asset', true, 'Cash on hand and in registers'),
    (p_business_id, '1010', 'Mobile Money', 'asset', true, 'MTN MoMo, Airtel Money'),
    (p_business_id, '1020', 'Bank Account', 'asset', true, 'Business bank account'),
    (p_business_id, '1100', 'Accounts Receivable', 'asset', true, 'Money owed by customers'),
    (p_business_id, '1200', 'Inventory', 'asset', true, 'Stock on hand (valued at AVCO)'),
    (p_business_id, '1300', 'Equipment', 'asset', true, 'POS machines, computers, etc.'),
    (p_business_id, '1310', 'Furniture & Fixtures', 'asset', true, 'Shelves, displays, counters')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- LIABILITIES (2xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '2000', 'Accounts Payable', 'liability', true, 'Money owed to suppliers'),
    (p_business_id, '2100', 'VAT Payable', 'liability', true, 'VAT collected, owed to URA'),
    (p_business_id, '2200', 'Salaries Payable', 'liability', true, 'Employee wages owed'),
    (p_business_id, '2300', 'Loans Payable', 'liability', true, 'Bank or SACCO loans')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- EQUITY (3xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '3000', 'Owner Equity', 'equity', true, 'Owner investment / capital'),
    (p_business_id, '3100', 'Retained Earnings', 'equity', true, 'Accumulated profits')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- REVENUE (4xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '4000', 'Sales Revenue', 'revenue', true, 'Income from product sales'),
    (p_business_id, '4010', 'Service Revenue', 'revenue', true, 'Income from services provided'), -- NEW
    (p_business_id, '4100', 'Sales Discount', 'revenue', true, 'Discounts given to customers'),
    (p_business_id, '4200', 'Sales Returns', 'revenue', true, 'Credit notes / returns'),
    (p_business_id, '4300', 'Other Income', 'revenue', true, 'Miscellaneous income')
  ON CONFLICT (business_id, code) DO NOTHING;

  -- EXPENSES (5xxx-6xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true, 'Direct cost of items sold'),
    (p_business_id, '5010', 'Cost of Services', 'expense', true, 'Direct costs related to services (labor, etc.)'), -- NEW
    (p_business_id, '5100', 'Purchase Expenses', 'expense', true, 'Cost of purchasing stock'),
    (p_business_id, '6000', 'Rent', 'expense', true, 'Shop / premises rent'),
    (p_business_id, '6010', 'Electricity', 'expense', true, 'UMEME / power bills'),
    (p_business_id, '6020', 'Water', 'expense', true, 'NWSC water bills'),
    (p_business_id, '6030', 'Transport', 'expense', true, 'Delivery, boda, fuel'),
    (p_business_id, '6040', 'Communication', 'expense', true, 'Airtime, data, internet'),
    (p_business_id, '6050', 'Salaries & Wages', 'expense', true, 'Employee compensation'),
    (p_business_id, '6060', 'Supplies', 'expense', true, 'Office and shop supplies'),
    (p_business_id, '6070', 'Repairs & Maintenance', 'expense', true, 'Equipment repairs'),
    (p_business_id, '6080', 'Insurance', 'expense', true, 'Business insurance'),
    (p_business_id, '6090', 'Bank Charges', 'expense', true, 'Bank fees'),
    (p_business_id, '6100', 'Taxes & Licenses', 'expense', true, 'Trading licenses, URA'),
    (p_business_id, '6200', 'Depreciation', 'expense', true, 'Asset depreciation'),
    (p_business_id, '6300', 'Miscellaneous Expense', 'expense', true, 'Other expenses')
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$;

-- 2. Add the new accounts to ALL EXISTING businesses
DO $$
DECLARE
    biz_id UUID;
BEGIN
    FOR biz_id IN SELECT id FROM businesses LOOP
        -- Add Service Revenue
        INSERT INTO accounts (business_id, code, name, account_type, is_system, description)
        VALUES (biz_id, '4010', 'Service Revenue', 'revenue', true, 'Income from services provided')
        ON CONFLICT (business_id, code) DO NOTHING;

        -- Add Cost of Services
        INSERT INTO accounts (business_id, code, name, account_type, is_system, description)
        VALUES (biz_id, '5010', 'Cost of Services', 'expense', true, 'Direct costs related to services (labor, etc.)')
        ON CONFLICT (business_id, code) DO NOTHING;
    END LOOP;
END;
$$;
