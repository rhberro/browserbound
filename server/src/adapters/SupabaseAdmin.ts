import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables for admin client');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function fetchDisplayName(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Error fetching display name:', error);
    return userId; // Fall back to user ID if display name fetch fails
  }

  return data?.display_name || userId;
}
