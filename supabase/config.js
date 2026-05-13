// Memori · Supabase client
// Reemplaza SUPABASE_URL y SUPABASE_ANON_KEY con los valores de tu proyecto:
//   Dashboard → Settings → API

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://mnqkxjnzqdduyhmjsnvc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lX9eAet5Dh8dhlIgRi3XdQ_bZSZajF-';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
