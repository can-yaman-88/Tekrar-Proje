import { zodResolver } from '@hookform/resolvers/zod';
import { describeError } from '@shared/lib/errors';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { authenticate } from '../data/auth.api';
import { type AuthMode, type Credentials, CredentialsSchema } from '../domain/credentials.schema';

/** Navigation after success is handled by the root Stack.Protected guards. */
export function useAuthForm() {
  const [mode, setMode] = useState<AuthMode>('signIn');
  const form = useForm<Credentials>({
    resolver: zodResolver(CredentialsSchema),
    defaultValues: { email: '', password: '' },
  });
  const mutation = useMutation({ mutationFn: (values: Credentials) => authenticate(mode, values) });

  return {
    mode,
    toggleMode: () => {
      mutation.reset();
      setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
    },
    control: form.control,
    errors: {
      email: form.formState.errors.email?.message ?? null,
      password: form.formState.errors.password?.message ?? null,
    },
    submitError: mutation.error ? describeError(mutation.error).message : null,
    isSubmitting: mutation.isPending,
    awaitingConfirmation: mode === 'signUp' && mutation.isSuccess,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
  };
}

export type AuthFormController = ReturnType<typeof useAuthForm>;
