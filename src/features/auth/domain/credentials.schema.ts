import { z } from 'zod';

export const CredentialsSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'At least 8 characters.'),
});

export type Credentials = z.infer<typeof CredentialsSchema>;
export type AuthMode = 'signIn' | 'signUp';
