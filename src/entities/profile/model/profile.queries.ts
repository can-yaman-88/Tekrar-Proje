import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileRepository } from '../data/profile.repository';

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

export function useSetAutoWeeklyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: profileMutationKeys.autoWeeklyPlan,
    mutationFn: (enabled: boolean) => profileRepository.setAutoWeeklyPlan(enabled),
    onSettled: () => queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  });
}

export function useSetBlockedWeekdays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: profileMutationKeys.blockedWeekdays,
    networkMode: 'always' as const,
    mutationFn: (weekdays: readonly number[]) => profileRepository.setBlockedWeekdays(weekdays),
    // Capacity feeds every plan on screen, not just this card.
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useSetCapacityOverrides() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: profileMutationKeys.capacityOverrides,
    networkMode: 'always' as const,
    mutationFn: (overrides: Readonly<Record<number, number>>) => profileRepository.setCapacityOverrides(overrides),
    // Capacity feeds every plan on screen, not just this card.
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useSetLlmApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: profileMutationKeys.apiKey,
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
