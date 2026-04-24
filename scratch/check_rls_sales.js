
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Manual env parsing
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
    // We can't check RLS status directly with ANON_KEY usually, 
    // but we can try to SELECT from a table and see if it returns something 
    // even if we know there is data (if we can find out if there is data).
    
    // Better: I'll just check if I can see ANY sales.
    const { data: sales, error } = await supabase.from('sales').select('id').limit(1);
    console.log('Sales query result:', sales ? sales.length : 0);
    if (error) console.log('Sales query error:', error.message);

    const { data: items, error: iErr } = await supabase.from('sale_items').select('id').limit(1);
    console.log('Sale Items query result:', items ? items.length : 0);
    if (iErr) console.log('Sale Items query error:', iErr.message);

  } catch (e) {
    console.error('Error:', e.message);
  }
}
run();
