import { clearPersistedQueryCache } from '@shared/api/query';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from '../data/auth.api';

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      clearPersistedQueryCache();
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });
}
