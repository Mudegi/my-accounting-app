
import { supabase } from '../lib/supabase';

async function checkTaxes() {
  const { data: businesses, error: bErr } = await supabase
    .from('businesses')
    .select('id, name, is_efris_enabled')
    .ilike('name', '%Kian%');

  if (bErr) {
    console.error('Error fetching business:', bErr);
    return;
  }

  for (const biz of businesses || []) {
    console.log(`Business: ${biz.name} (ID: ${biz.id})`);
    console.log(`EFRIS Enabled: ${biz.is_efris_enabled}`);

    const { data: taxes, error: tErr } = await supabase
      .from('tax_rates')
      .select('*')
      .eq('business_id', biz.id);

    if (tErr) {
      console.error('Error fetching taxes:', tErr);
    } else {
      console.log(`Tax Rates found: ${taxes?.length || 0}`);
      taxes?.forEach(t => {
        console.log(` - ${t.name} (Code: ${t.code}, Rate: ${t.rate}, Active: ${t.is_active})`);
      });
    }
  }
}

checkTaxes();
