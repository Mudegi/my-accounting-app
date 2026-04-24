
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...value] = line.split('=');
  if (key && value) env[key.trim()] = value.join('=').trim();
});

const supabase = createClient(
  env['EXPO_PUBLIC_SUPABASE_URL'],
  env['EXPO_PUBLIC_SUPABASE_ANON_KEY']
);

async function run() {
  try {
    // 1. Check all tax rates
    const { data: taxes } = await supabase.from('tax_rates').select('*, businesses(name)');
    console.log('--- ALL TAX RATES ---');
    taxes?.forEach(t => console.log(`[${t.businesses?.name}] ${t.name} | Code: ${t.code} | ID: ${t.id}`));

    // 2. Check if the user is authenticated in this context (to test get_my_business_id)
    const { data: { user } } = await supabase.auth.getUser();
    console.log('--- CURRENT AUTH USER ---');
    console.log(user ? user.id : 'NOT LOGGED IN (This context uses anon key)');

    // 3. Check for recent sales
    const { data: sales } = await supabase.from('sales').select('id, total_amount, created_at').order('created_at', { ascending: false }).limit(3);
    console.log('--- RECENT SALES ---');
    sales?.forEach(s => console.log(`Sale ID: ${s.id} | Total: ${s.total_amount} | Date: ${s.created_at}`));

  } catch (e) {
    console.error('Error:', e.message);
  }
}
run();
