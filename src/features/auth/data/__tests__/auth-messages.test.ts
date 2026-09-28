import { AppError } from '@shared/lib/errors';
import { authenticate } from '../auth.api';

jest.mock('@shared/api/supabase', () => ({
  supabase: { auth: { signInWithPassword: jest.fn(), signUp: jest.fn() } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require('@shared/api/supabase') as {
  supabase: { auth: { signInWithPassword: jest.Mock; signUp: jest.Mock } };
};

const failWith = (message: string, status = 400) => {
  supabase.auth.signInWithPassword.mockResolvedValue({ error: { message, status } });
};

describe('giriş hataları', () => {
  it('sunucunun İngilizce mesajlarını Türkçeye çevirir', async () => {
    failWith('Invalid login credentials');
    await expect(authenticate('signIn', { email: 'a@b.com', password: 'test12345' })).rejects.toMatchObject({
      kind: 'validation',
      message: 'E-posta ya da şifre hatalı.',
    });

    failWith('Email address "x@y.dev" is invalid');
    await expect(authenticate('signIn', { email: 'x@y.dev', password: 'test12345' })).rejects.toMatchObject({
      message: 'Bu e-posta adresi geçersiz görünüyor.',
    });
  });

  it('çok fazla denemeyi ayrı türde raporlar', async () => {
    failWith('too many requests', 429);
    await expect(authenticate('signIn', { email: 'a@b.com', password: 'test12345' })).rejects.toMatchObject({
      kind: 'rate_limited',
    });
  });

  it('tanımadığı mesajı olduğu gibi bırakır', async () => {
    failWith('Something unusual happened');
    const error = await authenticate('signIn', { email: 'a@b.com', password: 'test12345' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe('Something unusual happened');
  });
});
