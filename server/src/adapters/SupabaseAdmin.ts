import { createClient } from '@supabase/supabase-js';
import { resolveDisplayName } from '@browserbond/shared';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables for admin client');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function fetchDisplayName(userId: string, sessionId: string, email?: string): Promise<string> {
  // If service role key is not configured, skip profile operations and let
  // the resolver fall through to email/userId/sessionId.
  if (!supabaseServiceRoleKey || supabaseServiceRoleKey.includes('invalid')) {
    return resolveDisplayName(userId, { email }, sessionId);
  }

  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    return resolveDisplayName(userId, { displayName: data?.display_name, email }, sessionId);
  } catch (err) {
    console.warn(`⚠️  Error fetching profile: ${err instanceof Error ? err.message : String(err)}`);
    return resolveDisplayName(userId, { email }, sessionId);
  }
}
