import { useMutationState } from '@tanstack/react-query';

/** How many mutations are waiting for connectivity (the offline queue depth). */
export function useQueuedChangeCount(): number {
  return useMutationState({ filters: { predicate: (mutation) => mutation.state.isPaused } }).length;
}
