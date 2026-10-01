import {
  PROFILE_SCOPE,
  profileKeys,
  profileMutationKeys,
  runSetAutoWeeklyPlan,
  runSetBlockedWeekdays,
  runSetCapacityOverrides,
} from '@entities/profile';
import { taskMutationKeys, taskRepository, type TaskPatch, type TaskStatus } from '@entities/task';
import { taskNoteMutationKeys, taskNoteRepository } from '@entities/task-note';
import { taskSessionMutationKeys, taskSessionRepository } from '@entities/task-session';
import {
  runAddMistake,
  runDeleteMistake,
  runReopenMistake,
  runResolveMistake,
  runUpdateMistake,
  TOPIC_MISTAKE_SCOPE,
  topicMistakeKeys,
  topicMistakeMutationKeys,
} from '@entities/topic-mistake';
import { runToggle } from '@features/task-toggle-status';
import { queryClient } from '@shared/api/query';

export interface UpdateTaskVariables {
  taskId: string;
  patch: TaskPatch;
}
export interface SetTaskStatusVariables {
  taskId: string;
  status: TaskStatus;
}
export interface AddNoteVariables {
  taskId: string;
  body: string;
}
export interface StartSessionVariables {
  taskId: string;
  startedAt: string;
}
export interface StopSessionVariables {
  sessionId: string;
  minutes: number;
}
export interface LogSessionVariables {
  taskId: string;
  minutes: number;
}

/**
 * Offline queue: these mutations are registered by key so React Query can
 * replay them after a restart. While the device is offline they stay paused
 * (the optimistic UI already shows the result); they are sent automatically
 * when connectivity returns.
 */
export function registerMutationDefaults(): void {
  queryClient.setMutationDefaults(taskMutationKeys.toggle, { mutationFn: runToggle });
  queryClient.setMutationDefaults(taskMutationKeys.update, {
    mutationFn: ({ taskId, patch }: UpdateTaskVariables) => taskRepository.update(taskId, patch),
  });
  queryClient.setMutationDefaults(taskMutationKeys.setStatus, {
    mutationFn: ({ taskId, status }: SetTaskStatusVariables) => taskRepository.updateStatus(taskId, status),
  });
  queryClient.setMutationDefaults(taskMutationKeys.remove, {
    mutationFn: (taskId: string) => taskRepository.remove(taskId),
  });
  queryClient.setMutationDefaults(taskNoteMutationKeys.add, {
    mutationFn: ({ taskId, body }: AddNoteVariables) => taskNoteRepository.create(taskId, body),
  });
  // Stopwatch writes carry their own timestamps and measured minutes, so a
  // replay after a long offline stretch still records the study that happened.
  queryClient.setMutationDefaults(taskSessionMutationKeys.start, {
    mutationFn: ({ taskId, startedAt }: StartSessionVariables) => taskSessionRepository.start(taskId, startedAt),
  });
  queryClient.setMutationDefaults(taskSessionMutationKeys.stop, {
    mutationFn: ({ sessionId, minutes }: StopSessionVariables) => taskSessionRepository.stop(sessionId, minutes),
  });
  queryClient.setMutationDefaults(taskSessionMutationKeys.log, {
    mutationFn: ({ taskId, minutes }: LogSessionVariables) => taskSessionRepository.logManual(taskId, minutes),
  });

  // The mistake book and the settings each drain as one ordered queue. A
  // write replayed after a restart has no screen hook to refresh after it,
  // so the defaults do; a live hook's own onSettled takes their place.
  const book = {
    scope: TOPIC_MISTAKE_SCOPE,
    onSettled: () => queryClient.invalidateQueries({ queryKey: topicMistakeKeys.all }),
  };
  queryClient.setMutationDefaults(topicMistakeMutationKeys.add, { ...book, mutationFn: runAddMistake });
  queryClient.setMutationDefaults(topicMistakeMutationKeys.update, { ...book, mutationFn: runUpdateMistake });
  queryClient.setMutationDefaults(topicMistakeMutationKeys.resolve, { ...book, mutationFn: runResolveMistake });
  queryClient.setMutationDefaults(topicMistakeMutationKeys.reopen, { ...book, mutationFn: runReopenMistake });
  queryClient.setMutationDefaults(topicMistakeMutationKeys.remove, { ...book, mutationFn: runDeleteMistake });
  const profile = {
    scope: PROFILE_SCOPE,
    onSettled: () => queryClient.invalidateQueries({ queryKey: profileKeys.all }),
  };
  // Capacity feeds every plan on screen, not just the settings card.
  const capacity = { scope: PROFILE_SCOPE, onSettled: () => queryClient.invalidateQueries() };
  queryClient.setMutationDefaults(profileMutationKeys.autoWeeklyPlan, { ...profile, mutationFn: runSetAutoWeeklyPlan });
  queryClient.setMutationDefaults(profileMutationKeys.blockedWeekdays, {
    ...capacity,
    mutationFn: runSetBlockedWeekdays,
  });
  queryClient.setMutationDefaults(profileMutationKeys.capacityOverrides, {
    ...capacity,
    mutationFn: runSetCapacityOverrides,
  });
}
