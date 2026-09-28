import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';
import { secureAuthStorage } from '../../lib/storage';
import type { Database } from './types';

export type TypedSupabaseClient = SupabaseClient<Database>;

export const supabase: TypedSupabaseClient = createClient<Database>(
  env.EXPO_PUBLIC_SUPABASE_URL,
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: secureAuthStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
