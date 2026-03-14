-- ============================================
-- YourBooks Lite - Field Sales Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. FIELD STOCK ASSIGNMENTS TABLE
-- Tracks stock assigned to field sales personnel
create table field_stock_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  user_id uuid references auth.users(id),
  product_id uuid references products(id),
  qty_assigned int not null default 0,
  qty_returned int not null default 0,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz default now(),
  returned_at timestamptz,
  status text default 'active' check (status in ('active', 'partially_returned', 'returned', 'voided')),
  notes text,
  created_at timestamptz default now()
);

-- 2. ADD FIELD SALES COLUMNS TO SALES TABLE
-- These are additive — existing sales are unaffected
alter table sales add column if not exists is_field_sale boolean default false;
alter table sales add column if not exists gps_lat numeric(10,7);
alter table sales add column if not exists gps_lng numeric(10,7);
alter table sales add column if not exists approved_by uuid references auth.users(id);
alter table sales add column if not exists approved_at timestamptz;
alter table sales add column if not exists field_assignment_id uuid references field_stock_assignments(id);

-- Update the status check constraint to include 'pending_approval'
-- First drop the old one, then add the new one
alter table sales drop constraint if exists sales_status_check;
alter table sales add constraint sales_status_check
  check (status in ('draft', 'completed', 'voided', 'pending_approval'));

-- 3. ADD FIELD SOURCE COLUMNS TO CUSTOMERS TABLE
alter table customers add column if not exists source text default 'in_store';
alter table customers add column if not exists created_by uuid references auth.users(id);

-- 4. RLS POLICIES FOR FIELD STOCK ASSIGNMENTS
alter table field_stock_assignments enable row level security;

-- Users can view assignments in their business
create policy "Users can view own business assignments"
  on field_stock_assignments for select
  using (business_id in (select business_id from profiles where id = auth.uid()));

-- Admins/managers can create assignments
create policy "Admins can create assignments"
  on field_stock_assignments for insert
  with check (business_id in (
    select business_id from profiles where id = auth.uid() and role in ('admin', 'branch_manager')
  ));

-- Admins/managers can update assignments (for returns, voiding)
create policy "Admins can update assignments"
  on field_stock_assignments for update
  using (business_id in (
    select business_id from profiles where id = auth.uid() and role in ('admin', 'branch_manager')
  ));

-- Field users can also update their own assignments (for recording returns)
create policy "Users can update own assignments"
  on field_stock_assignments for update
  using (user_id = auth.uid());

-- 5. ALLOW ADMINS TO UPDATE SALES (for approval workflow)
-- Check if policy exists before creating
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'sales' and policyname = 'Admins can update sales'
  ) then
    execute 'create policy "Admins can update sales"
      on sales for update
      using (business_id in (
        select business_id from profiles where id = auth.uid() and role in (''admin'', ''branch_manager'')
      ))';
  end if;
end $$;

-- 6. INDEXES FOR PERFORMANCE
create index if not exists idx_field_assignments_business on field_stock_assignments(business_id);
create index if not exists idx_field_assignments_user on field_stock_assignments(user_id);
create index if not exists idx_field_assignments_product on field_stock_assignments(product_id);
create index if not exists idx_field_assignments_status on field_stock_assignments(status);
create index if not exists idx_sales_is_field on sales(is_field_sale) where is_field_sale = true;
create index if not exists idx_sales_status_pending on sales(status) where status = 'pending_approval';
create index if not exists idx_customers_source on customers(source) where source = 'field';
create index if not exists idx_customers_created_by on customers(created_by);
