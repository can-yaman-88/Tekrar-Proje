import { z } from 'zod';

const EnvSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

// Each variable must be referenced statically so Expo can inline it at build time.
const parsed = EnvSchema.safeParse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

/**
 * Set when the build has no usable Supabase configuration. The root layout shows
 * it as a readable screen; throwing here would crash before any UI exists.
 */
export const envError: string | null = parsed.success
  ? null
  : 'Supabase ayarları eksik. .env dosyasında EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı olmalı, sonra uygulamayı yeniden derle.';

export const env = parsed.success
  ? parsed.data
  : { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'missing' };
