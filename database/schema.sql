-- ============================================
-- YourBooks Lite - Supabase Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. BUSINESSES TABLE (The Account)
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tin text, -- Tax Identification Number (for EFRIS)
  phone text,
  email text,
  address text,
  is_efris_enabled boolean default false,
  app_mode text default 'basic' check (app_mode in ('basic', 'pro')),
  created_at timestamptz default now()
);

-- 2. BRANCHES TABLE
create table branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  location text,
  phone text,
  is_efris_enabled boolean default false,
  efris_device_no text, -- EFRIS device number per branch
  created_at timestamptz default now()
);

-- 3. PROFILES TABLE (Users/Roles)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  full_name text not null,
  role text not null default 'salesperson' check (role in ('admin', 'branch_manager', 'salesperson')),
  phone text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 4. PRODUCT CATEGORIES
create table categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  ura_product_code text, -- URA Standardized Product Code for EFRIS
  created_at timestamptz default now()
);

-- 5. PRODUCTS TABLE
create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  barcode text,
  sku text,
  image_url text,
  description text,
  unit text default 'piece', -- piece, kg, litre, box, etc.
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 6. INVENTORY (Stock per Branch)
create table inventory (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  quantity int default 0,
  avg_cost_price numeric(15,2) default 0, -- AVCO (Weighted Average Cost)
  selling_price numeric(15,2) default 0,
  reorder_level int default 5, -- Low stock alert threshold
  updated_at timestamptz default now(),
  unique(branch_id, product_id)
);

-- 7. SALES TABLE (Receipt/Invoice Header)
create table sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  seller_id uuid references auth.users(id),
  customer_name text,
  customer_phone text,
  subtotal numeric(15,2) not null default 0,
  tax_amount numeric(15,2) default 0,
  total_amount numeric(15,2) not null default 0,
  payment_method text default 'cash' check (payment_method in ('cash', 'mobile_money', 'card', 'credit')),
  is_fiscalized boolean default false,
  efris_fdn text,
  efris_verification_code text,
  efris_qr_code text,
  status text default 'completed' check (status in ('draft', 'completed', 'voided')),
  created_at timestamptz default now()
);

-- 8. SALE ITEMS (Receipt/Invoice Lines)
create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null, -- Store name at time of sale
  quantity int not null default 1,
  unit_price numeric(15,2) not null,
  cost_price numeric(15,2) default 0, -- Snapshot of AVCO at time of sale
  tax_rate numeric(5,2) default 0,
  line_total numeric(15,2) not null,
  created_at timestamptz default now()
);

-- 9. PURCHASES (Stock In)
create table purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  supplier_name text,
  total_amount numeric(15,2) not null default 0,
  notes text,
  created_at timestamptz default now()
);

-- 10. PURCHASE ITEMS
create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid references purchases(id) on delete cascade,
  product_id uuid references products(id),
  quantity int not null,
  unit_cost numeric(15,2) not null,
  line_total numeric(15,2) not null,
  created_at timestamptz default now()
);

-- 11. STOCK TRANSFERS (Between Branches)
create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  from_branch_id uuid references branches(id),
  to_branch_id uuid references branches(id),
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  status text default 'pending' check (status in ('pending', 'in_transit', 'received', 'cancelled')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 12. STOCK TRANSFER ITEMS
create table stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid references stock_transfers(id) on delete cascade,
  product_id uuid references products(id),
  quantity int not null,
  created_at timestamptz default now()
);

-- 13. EXPENSES
create table expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  recorded_by uuid references auth.users(id),
  category text not null, -- Rent, Electricity, Transport, etc.
  description text,
  amount numeric(15,2) not null,
  date date default current_date,
  created_at timestamptz default now()
);

-- 14. AUDIT LOG (Anti-theft / Trust)
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id),
  user_id uuid references auth.users(id),
  action text not null, -- 'sale_created', 'price_changed', 'stock_adjusted', etc.
  table_name text,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS) Policies
-- ============================================

-- Enable RLS on all tables
alter table businesses enable row level security;
alter table branches enable row level security;
alter table profiles enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;
alter table expenses enable row level security;
alter table audit_log enable row level security;

-- Profiles: users can read their own profile
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Profiles: users can update their own profile
create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Business-scoped policies (users see only their business data)
create policy "Users can view own business"
  on businesses for select
  using (id in (select business_id from profiles where id = auth.uid()));

create policy "Users can view own branches"
  on branches for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can view own products"
  on products for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can view own categories"
  on categories for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can view own inventory"
  on inventory for select
  using (branch_id in (
    select b.id from branches b
    join profiles p on p.business_id = b.business_id
    where p.id = auth.uid()
  ));

create policy "Users can view own sales"
  on sales for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can view own sale items"
  on sale_items for select
  using (sale_id in (
    select s.id from sales s
    join profiles p on p.business_id = s.business_id
    where p.id = auth.uid()
  ));

-- Admin-only insert/update policies
create policy "Admins can insert branches"
  on branches for insert
  with check (business_id in (
    select business_id from profiles where id = auth.uid() and role = 'admin'
  ));

create policy "Admins can insert products"
  on products for insert
  with check (business_id in (
    select business_id from profiles where id = auth.uid() and role in ('admin', 'branch_manager')
  ));

create policy "Admins can update products"
  on products for update
  using (business_id in (
    select business_id from profiles where id = auth.uid() and role in ('admin', 'branch_manager')
  ));

create policy "Admins can insert categories"
  on categories for insert
  with check (business_id in (
    select business_id from profiles where id = auth.uid() and role in ('admin', 'branch_manager')
  ));

-- Sales: any authenticated user in the business can create
create policy "Users can create sales"
  on sales for insert
  with check (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can create sale items"
  on sale_items for insert
  with check (sale_id in (
    select s.id from sales s
    join profiles p on p.business_id = s.business_id
    where p.id = auth.uid()
  ));

-- Inventory: managers and admins can update
create policy "Managers can update inventory"
  on inventory for update
  using (branch_id in (
    select b.id from branches b
    join profiles p on p.business_id = b.business_id
    where p.id = auth.uid() and p.role in ('admin', 'branch_manager')
  ));

create policy "Managers can insert inventory"
  on inventory for insert
  with check (branch_id in (
    select b.id from branches b
    join profiles p on p.business_id = b.business_id
    where p.id = auth.uid() and p.role in ('admin', 'branch_manager')
  ));

-- Expenses
create policy "Users can view own expenses"
  on expenses for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can create expenses"
  on expenses for insert
  with check (business_id in (select business_id from profiles where id = auth.uid()));

-- Stock transfers
create policy "Users can view own transfers"
  on stock_transfers for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can create transfers"
  on stock_transfers for insert
  with check (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Users can view transfer items"
  on stock_transfer_items for select
  using (transfer_id in (
    select st.id from stock_transfers st
    join profiles p on p.business_id = st.business_id
    where p.id = auth.uid()
  ));

create policy "Users can insert transfer items"
  on stock_transfer_items for insert
  with check (transfer_id in (
    select st.id from stock_transfers st
    join profiles p on p.business_id = st.business_id
    where p.id = auth.uid()
  ));

-- Purchases
create policy "Users can view own purchases"
  on purchases for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

create policy "Managers can create purchases"
  on purchases for insert
  with check (business_id in (
    select business_id from profiles where id = auth.uid() and role in ('admin', 'branch_manager')
  ));

create policy "Users can view purchase items"
  on purchase_items for select
  using (purchase_id in (
    select pu.id from purchases pu
    join profiles p on p.business_id = pu.business_id
    where p.id = auth.uid()
  ));

create policy "Managers can insert purchase items"
  on purchase_items for insert
  with check (purchase_id in (
    select pu.id from purchases pu
    join profiles p on p.business_id = pu.business_id
    where p.id = auth.uid() and p.role in ('admin', 'branch_manager')
  ));

-- Audit log
create policy "Admins can view audit log"
  on audit_log for select
  using (business_id in (
    select business_id from profiles where id = auth.uid() and role = 'admin'
  ));

create policy "System can insert audit log"
  on audit_log for insert
  with check (business_id in (select business_id from profiles where id = auth.uid()));

-- ============================================
-- INDEXES for performance
-- ============================================
create index idx_branches_business on branches(business_id);
create index idx_profiles_business on profiles(business_id);
create index idx_products_business on products(business_id);
create index idx_products_barcode on products(barcode);
create index idx_inventory_branch on inventory(branch_id);
create index idx_inventory_product on inventory(product_id);
create index idx_sales_branch on sales(branch_id);
create index idx_sales_created on sales(created_at);
create index idx_sale_items_sale on sale_items(sale_id);
create index idx_expenses_branch on expenses(branch_id);
create index idx_audit_log_business on audit_log(business_id);
create index idx_stock_transfers_business on stock_transfers(business_id);
