
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
    // 1. Get session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.log('NO ACTIVE SESSION found in this context.');
      return;
    }
    const uid = session.user.id;
    console.log('Authenticated UID:', uid);

    // 2. Check profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', uid).single();
    console.log('Profile:', JSON.stringify(profile, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  }
}
run();
