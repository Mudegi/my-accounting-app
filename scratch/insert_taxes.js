
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
    // We need to find the business ID first. 
    // Since ANON_KEY might not see businesses due to RLS, 
    // we'll try to find a profile first (usually more permissive).
    const { data: profiles } = await supabase.from('profiles').select('business_id').limit(1);
    if (!profiles || profiles.length === 0) return console.log('No profile found to determine business ID');
    
    const bizId = profiles[0].business_id;
    console.log('Target Business ID:', bizId);

    const standardTaxes = [
      { business_id: bizId, name: 'Standard (18%)', code: '01', rate: 0.18, is_default: true, is_active: true },
      { business_id: bizId, name: 'Zero Rated (0%)', code: '02', rate: 0.00, is_default: false, is_active: true },
      { business_id: bizId, name: 'Exempt (0%)', code: '03', rate: 0.00, is_default: false, is_active: true }
    ];

    console.log('Inserting tax rates...');
    const { data, error } = await supabase.from('tax_rates').insert(standardTaxes);
    
    if (error) {
      console.error('Error inserting taxes:', error.message);
    } else {
      console.log('Tax rates inserted successfully!');
    }
  } catch (e) {
    console.error('Unexpected Error:', e.message);
  }
}
run();
