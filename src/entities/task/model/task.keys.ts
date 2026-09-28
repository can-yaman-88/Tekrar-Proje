import type { IsoDate } from '@contracts/enums.contract';

export const taskKeys = {
  all: ['tasks'] as const,
  mission: (today: IsoDate) => [...taskKeys.all, 'mission', today] as const,
  detail: (taskId: string) => [...taskKeys.all, 'detail', taskId] as const,
  subtasks: (taskId: string) => [...taskKeys.all, 'subtasks', taskId] as const,
  backlog: (before: IsoDate) => [...taskKeys.all, 'backlog', before] as const,
  history: () => [...taskKeys.all, 'history'] as const,
  week: (weekStart: IsoDate) => [...taskKeys.all, 'week', weekStart] as const,
};

/** Keys of the mutations that survive a restart (see core/bootstrap/mutationDefaults). */
export const taskMutationKeys = {
  toggle: [...taskKeys.all, 'toggle'] as const,
  update: [...taskKeys.all, 'update'] as const,
  setStatus: [...taskKeys.all, 'set-status'] as const,
  remove: [...taskKeys.all, 'delete'] as const,
};
