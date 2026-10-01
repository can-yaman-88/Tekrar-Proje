import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileRepository } from '../data/profile.repository';
import type { Profile } from '../domain/profile';

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
};

export function useProfile() {
  return useQuery({ queryKey: profileKeys.me(), queryFn: () => profileRepository.get() });
}

export const profileMutationKeys = {
  autoWeeklyPlan: [...profileKeys.all, 'auto-weekly-plan'] as const,
  apiKey: [...profileKeys.all, 'api-key'] as const,
  blockedWeekdays: [...profileKeys.all, 'blocked-weekdays'] as const,
  capacityOverrides: [...profileKeys.all, 'capacity-overrides'] as const,
};

/** Settings writes reach the server in the order they were made. */
export const PROFILE_SCOPE = { id: 'profile' } as const;

export const runSetAutoWeeklyPlan = (enabled: boolean) => profileRepository.setAutoWeeklyPlan(enabled);
export const runSetBlockedWeekdays = (weekdays: readonly number[]) => profileRepository.setBlockedWeekdays(weekdays);
export const runSetCapacityOverrides = (overrides: Readonly<Record<number, number>>) =>
  profileRepository.setCapacityOverrides(overrides);

/**
 * A settings write that shows at once, waits in the offline queue when there
 * is no connection, and is rolled back if the server refuses it.
 */
function useProfileSetting<TVariables>(
  mutationKey: readonly unknown[],
  mutationFn: (variables: TVariables) => Promise<void>,
  apply: (profile: Profile, variables: TVariables) => Profile,
  /** Capacity feeds every plan on screen, not just the card that changed it. */
  refreshEverything = false,
) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, TVariables, { previous: Profile | undefined }>({
    mutationKey,
    scope: PROFILE_SCOPE,
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: profileKeys.me() });
      const previous = queryClient.getQueryData<Profile>(profileKeys.me());
      if (previous) queryClient.setQueryData<Profile>(profileKeys.me(), apply(previous, variables));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(profileKeys.me(), context.previous);
    },
    onSettled: () =>
      refreshEverything ? queryClient.invalidateQueries() : queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  });
}

export const useSetAutoWeeklyPlan = () =>
  useProfileSetting(profileMutationKeys.autoWeeklyPlan, runSetAutoWeeklyPlan, (profile, enabled: boolean) => ({
    ...profile,
    autoWeeklyPlan: enabled,
  }));

export const useSetBlockedWeekdays = () =>
  useProfileSetting(
    profileMutationKeys.blockedWeekdays,
    runSetBlockedWeekdays,
    (profile, weekdays: readonly number[]) => ({ ...profile, blockedWeekdays: [...new Set(weekdays)].sort((a, b) => a - b) }),
    true,
  );

export const useSetCapacityOverrides = () =>
  useProfileSetting(
    profileMutationKeys.capacityOverrides,
    runSetCapacityOverrides,
    (profile, overrides: Readonly<Record<number, number>>) => ({ ...profile, capacityOverrides: { ...overrides } }),
    true,
  );

export function useSetLlmApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: profileMutationKeys.apiKey,
    // A secret is checked and stored on the spot or not at all — never left
    // waiting in the persisted queue.
    networkMode: 'always',
    mutationFn: (apiKey: string) => profileRepository.setLlmApiKey(apiKey),
    onSettled: () => queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  });
}

export function useClearLlmApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => profileRepository.clearLlmApiKey(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  });
}
