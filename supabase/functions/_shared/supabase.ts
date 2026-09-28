import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import type { Env } from './env.ts';
import { HttpError } from './errors.ts';

export type TypedClient = SupabaseClient<Database>;

const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Bypasses RLS. Every query made with it MUST filter by the authenticated user id. */
export function createServiceClient(env: Env): TypedClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: serverAuth });
}

/** Acts as the caller: RLS applies, used for reads as defence in depth. */
export function createUserClient(env: Env, authorization: string): TypedClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: serverAuth,
    global: { headers: { Authorization: authorization } },
  });
}

export interface AuthenticatedCaller {
  userId: string;
  userClient: TypedClient;
}

export async function authenticate(req: Request, env: Env, service: TypedClient): Promise<AuthenticatedCaller> {
  const authorization = req.headers.get('Authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!authorization || !token) throw new HttpError('unauthorized', 'Missing bearer token.');

  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new HttpError('unauthorized', 'Invalid or expired session.', { cause: error });

  return { userId: data.user.id, userClient: createUserClient(env, authorization) };
}
