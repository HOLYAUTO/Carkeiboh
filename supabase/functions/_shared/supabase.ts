import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError, requireEnv } from './http.ts';

export type { SupabaseClient };

/** service_role の接続。RLS を通らないので、呼び出し元の確認を必ず先に行うこと */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request, admin: SupabaseClient): Promise<{ id: string }> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthorized');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthorized');
  return { id: data.user.id };
}
