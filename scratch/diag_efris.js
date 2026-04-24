
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
    const { data: profile } = await supabase.from('profiles').select('business_id').limit(1).single();
    if (!profile) return console.log('No profile found');

    const { data: biz } = await supabase.from('businesses').select('*').eq('id', profile.business_id).single();
    console.log('Business:', biz.name);
    console.log('EFRIS Enabled:', biz.is_efris_enabled);

    const { data: taxes } = await supabase.from('tax_rates').select('*').eq('business_id', biz.id);
    console.log('Taxes found:', taxes ? taxes.length : 0);
    if (taxes) {
      taxes.forEach(t => console.log(`- ${t.name}: ${t.rate * 100}% (Code: ${t.code}, Active: ${t.is_active})`));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}
run();
