import type { IsoDate } from '@contracts/enums.contract';

export const taskKeys = {
  all: ['tasks'] as const,
  mission: (today: IsoDate) => [...taskKeys.all, 'mission', today] as const,
  detail: (taskId: string) => [...taskKeys.all, 'detail', taskId] as const,
  subtasks: (taskId: string) => [...taskKeys.all, 'subtasks', taskId] as const,
  backlog: (before: IsoDate) => [...taskKeys.all, 'backlog', before] as const,
  // Paged (an infinite query). Not 'history': before paging that key held a
  // plain array, and a cache persisted by an older install would be read as
  // pages and crash the screen.
  history: () => [...taskKeys.all, 'history-pages'] as const,
  historyCounts: () => [...taskKeys.all, 'history-counts'] as const,
  week: (weekStart: IsoDate) => [...taskKeys.all, 'week', weekStart] as const,
  forTopic: (topicId: string) => [...taskKeys.all, 'topic', topicId] as const,
  completedSince: (since: IsoDate) => [...taskKeys.all, 'completed-since', since] as const,
};

/** Keys of the mutations that survive a restart (see core/bootstrap/mutationDefaults). */
export const taskMutationKeys = {
  toggle: [...taskKeys.all, 'toggle'] as const,
  update: [...taskKeys.all, 'update'] as const,
  setStatus: [...taskKeys.all, 'set-status'] as const,
  remove: [...taskKeys.all, 'delete'] as const,
  setPriority: [...taskKeys.all, 'set-priority'] as const,
  completeMixedSet: [...taskKeys.all, 'complete-mixed-set'] as const,
};
