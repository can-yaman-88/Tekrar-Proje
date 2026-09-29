import { nextStatusOnToggle, taskMutationKeys, taskRepository, type Task, type TaskPatch, type TaskStatus } from '@entities/task';
import { taskNoteMutationKeys, taskNoteRepository } from '@entities/task-note';
import { taskSessionMutationKeys, taskSessionRepository } from '@entities/task-session';
import { queryClient } from '@shared/api/query';

export interface UpdateTaskVariables {
  taskId: string;
  patch: TaskPatch;
}
export interface SetTaskPriorityVariables {
  taskId: string;
  isPriority: boolean;
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
  queryClient.setMutationDefaults(taskMutationKeys.toggle, {
    mutationFn: (task: Task) => taskRepository.updateStatus(task.id, nextStatusOnToggle(task)),
  });
  queryClient.setMutationDefaults(taskMutationKeys.update, {
    mutationFn: ({ taskId, patch }: UpdateTaskVariables) => taskRepository.update(taskId, patch),
  });
  queryClient.setMutationDefaults(taskMutationKeys.setStatus, {
    mutationFn: ({ taskId, status }: SetTaskStatusVariables) => taskRepository.updateStatus(taskId, status),
  });
  queryClient.setMutationDefaults(taskMutationKeys.setPriority, {
    mutationFn: ({ taskId, isPriority }: SetTaskPriorityVariables) => taskRepository.setPriority(taskId, isPriority),
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
}
