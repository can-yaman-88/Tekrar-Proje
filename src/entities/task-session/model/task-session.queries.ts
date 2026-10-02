import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { taskSessionRepository } from '../data/task-session.repository';
import type { TaskSession } from '../domain/task-session';

export const taskSessionKeys = {
  all: ['task-sessions'] as const,
  running: ['task-sessions', 'running'] as const,
  /** A task, or a group with its steps: one list across both clocks. */
  forTasks: (taskIds: readonly string[]) => ['task-sessions', 'tasks', ...taskIds] as const,
  since: (from: string) => ['task-sessions', 'since', from] as const,
  measured: (from: string) => ['task-sessions', 'measured', from] as const,
};

export const taskSessionMutationKeys = {
  start: [...taskSessionKeys.all, 'start'] as const,
  stop: [...taskSessionKeys.all, 'stop'] as const,
  log: [...taskSessionKeys.all, 'log'] as const,
  remove: [...taskSessionKeys.all, 'remove'] as const,
};

export function useRunningSession() {
  return useQuery({
    queryKey: taskSessionKeys.running,
    queryFn: () => taskSessionRepository.findRunning(),
  });
}

/** Every stretch on these tasks, newest first, from both clocks. */
export function useTaskSessions(taskIds: readonly string[]) {
  return useQuery({
    queryKey: taskSessionKeys.forTasks(taskIds),
    queryFn: () => taskSessionRepository.listForTasks(taskIds),
    enabled: taskIds.length > 0,
  });
}

export function useSessionsSince(from: string) {
  return useQuery({
    queryKey: taskSessionKeys.since(from),
    queryFn: () => taskSessionRepository.listSince(from),
  });
}

/** Closed sessions joined with their task, for estimate-vs-actual calibration. */
export function useMeasuredWork(from: string) {
  return useQuery({
    queryKey: taskSessionKeys.measured(from),
    queryFn: () => taskSessionRepository.listMeasuredWork(from),
  });
}

function useSessionMutation<TArgs>(
  mutationKey: readonly unknown[],
  mutationFn: (args: TArgs) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey,
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskSessionKeys.all }),
  });
}

export function useStartSession() {
  return useSessionMutation(
    taskSessionMutationKeys.start,
    ({ taskId, startedAt }: { taskId: string; startedAt: string }) =>
      taskSessionRepository.start(taskId, startedAt),
  );
}

export function useStopSession() {
  return useSessionMutation(
    taskSessionMutationKeys.stop,
    ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      taskSessionRepository.stop(sessionId, minutes),
  );
}

export function useLogManualSession() {
  return useSessionMutation(taskSessionMutationKeys.log, ({ taskId, minutes }: { taskId: string; minutes: number }) =>
    taskSessionRepository.logManual(taskId, minutes),
  );
}

export function useDeleteSession() {
  return useSessionMutation(
    taskSessionMutationKeys.remove,
    ({ session }: { session: Pick<TaskSession, 'id' | 'clock'> }) => taskSessionRepository.remove(session),
  );
}
