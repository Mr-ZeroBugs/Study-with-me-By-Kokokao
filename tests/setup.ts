// Pure manager tests import client modules that construct the Supabase SDK at
// module load. Use non-secret placeholders so tests remain deterministic and
// never connect to a real project.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
