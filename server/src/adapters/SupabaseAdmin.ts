import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables for admin client');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function fetchDisplayName(userId: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    if (error) {
      console.warn(`⚠️  Could not fetch display name for ${userId}: ${error.message}`);
      return userId; // Fall back to user ID if display name fetch fails
    }

    return data?.display_name || userId;
  } catch (err) {
    console.warn(`⚠️  Error fetching display name: ${err instanceof Error ? err.message : String(err)}`);
    return userId; // Fall back to user ID on any error
  }
}
