import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables for admin client');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function fetchDisplayName(userId: string, email?: string): Promise<string> {
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

    // If profile doesn't exist or has no display name, try to create one
    if (email) {
      const displayName = email.split('@')[0]; // Use email prefix as display name

      try {
        // Try to insert a new profile if it doesn't exist
        const { error: insertError } = await supabaseAdmin
          .from('profiles')
          .insert([
            {
              id: userId,
              display_name: displayName,
              email: email,
            }
          ])
          .select()
          .single();

        if (!insertError) {
          console.log(`✅ Created profile for ${userId}`);
          return displayName;
        }
      } catch (insertErr) {
        // Profile might already exist, just use email as fallback
        console.log(`ℹ️  Using email as display name for ${userId}`);
        return displayName;
      }
    }

    // Final fallback: use user ID
    console.warn(`⚠️  Could not fetch or create profile for ${userId}`);
    return userId;
  } catch (err) {
    console.warn(`⚠️  Error handling display name: ${err instanceof Error ? err.message : String(err)}`);
    return email ? email.split('@')[0] : userId; // Use email or ID as last resort
  }
}
