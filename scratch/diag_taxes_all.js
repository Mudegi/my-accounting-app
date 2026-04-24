
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
    const { data: taxes } = await supabase.from('tax_rates').select('*, businesses(name)');
    console.log('Total Tax Rates found:', taxes ? taxes.length : 0);
    if (taxes) {
      taxes.forEach(t => {
        console.log(`- Business: ${t.businesses ? t.businesses.name : 'Unknown'} | Tax: ${t.name} (${t.rate*100}%) Code: ${t.code}`);
      });
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}
run();
