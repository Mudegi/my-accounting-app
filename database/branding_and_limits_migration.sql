-- 1. Add logo_url to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_url text;

-- 2. Add credit_limit to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit numeric(15,2) DEFAULT 0;

-- 3. Ensure Storage bucket exists for logos (optional policy if supported)
-- Note: You should manually create a public bucket named 'business-logos' in Supabase Storage.
-- This script adds a policy to allow authenticated users to upload their own business logos.

-- Create policies for storage (run these in SQL editor)
-- insert into storage.buckets (id, name, public) values ('business-logos', 'business-logos', true) on conflict do nothing;

-- create policy "Business can upload their own logo"
-- on storage.objects for insert with check (
--   bucket_id = 'business-logos' AND
--   (storage.foldername(name))[1] = (SELECT business_id::text FROM profiles WHERE id = auth.uid())
-- );
