import { supabase } from '@shared/api/supabase';
import { AppError, toAppError } from '@shared/lib/errors';
import type { AuthMode, Credentials } from '../domain/credentials.schema';

/** Supabase answers in English; these are the cases a student actually hits. */
const MESSAGES: { match: RegExp; message: string }[] = [
  { match: /invalid login credentials/i, message: 'E-posta ya da şifre hatalı.' },
  { match: /email address .* is invalid|invalid email/i, message: 'Bu e-posta adresi geçersiz görünüyor.' },
  { match: /user already registered|already been registered/i, message: 'Bu e-posta zaten kayıtlı. Giriş yapmayı dene.' },
  { match: /email not confirmed/i, message: 'Önce e-postandaki onay bağlantısına tıkla.' },
  { match: /password should be at least/i, message: 'Şifre en az 8 karakter olmalı.' },
  { match: /email rate limit|over_email_send_rate_limit/i, message: 'Çok fazla e-posta gönderildi. Biraz bekle.' },
  { match: /signups not allowed|signup is disabled/i, message: 'Bu projede yeni kayıt kapalı.' },
];

const translate = (message: string): string =>
  MESSAGES.find((entry) => entry.match.test(message))?.message ?? message;

export async function authenticate(mode: AuthMode, { email, password }: Credentials): Promise<void> {
  const { error } =
    mode === 'signIn'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
  if (!error) return;

  if (error.status === 429) {
    throw new AppError('rate_limited', 'Çok fazla deneme. Biraz sonra tekrar dene.', { cause: error });
  }
  if (error.status !== undefined && error.status >= 400 && error.status < 500) {
    throw new AppError('validation', translate(error.message), { cause: error });
  }
  throw toAppError(error);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw toAppError(error);
}
