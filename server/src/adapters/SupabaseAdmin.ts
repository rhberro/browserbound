import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables for admin client');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function fetchDisplayName(userId: string, email?: string): Promise<string> {
  // If service role key is not configured, skip profile operations
  if (!supabaseServiceRoleKey || supabaseServiceRoleKey.includes('invalid')) {
    if (email) {
      const displayName = email.split('@')[0];
      console.log(`ℹ️  Using email (${displayName}) as display name for ${userId}`);
      return displayName;
    }
    return userId;
  }

  try {
    // Try to fetch existing profile
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    if (data?.display_name) {
      return data.display_name;
    }

    // If profile doesn't exist, use email prefix as fallback
    if (email) {
      const displayName = email.split('@')[0];
      console.log(`ℹ️  No profile found. Using email (${displayName}) as display name for ${userId}`);
      return displayName;
    }

    // Final fallback: use user ID
    console.log(`ℹ️  Using user ID as display name for ${userId}`);
    return userId;
  } catch (err) {
    console.warn(`⚠️  Error fetching profile: ${err instanceof Error ? err.message : String(err)}`);
    return email ? email.split('@')[0] : userId; // Use email or ID as fallback
  }
}
