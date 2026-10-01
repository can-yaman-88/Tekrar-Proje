import type { IsoDate } from '@contracts/enums.contract';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { taskRepository } from '../data/task.repository';
import { taskKeys } from './task.keys';

export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => taskRepository.getById(taskId),
  });
}

const HISTORY_PAGE_SIZE = 40;

/** Finished work, a page at a time; the next page loads when the list nears its end. */
export function useFinishedTaskPages() {
  return useInfiniteQuery({
    queryKey: taskKeys.history(),
    queryFn: ({ pageParam }) => taskRepository.listFinishedPage(pageParam, HISTORY_PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < HISTORY_PAGE_SIZE ? undefined : allPages.length),
  });
}

/** The real totals, not the length of what happens to be loaded. */
export function useFinishedCounts() {
  return useQuery({ queryKey: taskKeys.historyCounts(), queryFn: () => taskRepository.countFinished() });
}

export function useWeekTasks(weekStart: IsoDate, weekEnd: IsoDate) {
  return useQuery({
    queryKey: taskKeys.week(weekStart),
    queryFn: () => taskRepository.listBetween(weekStart, weekEnd),
  });
}

/** The pile of work that is past due and still open. */
export function useBacklog(before: IsoDate) {
  return useQuery({
    queryKey: taskKeys.backlog(before),
    queryFn: () => taskRepository.listBacklog(before),
  });
}

export function useMissionTasks(today: IsoDate) {
  return useQuery({
    queryKey: taskKeys.mission(today),
    queryFn: () => taskRepository.listMission(today),
  });
}

/** Every task of one topic — the topic screen's own list. */
export function useTopicTasks(topicId: string) {
  return useQuery({
    queryKey: taskKeys.forTopic(topicId),
    queryFn: () => taskRepository.listForTopic(topicId),
  });
}

/** Finished work since a day, for the capacity learner. */
export function useCompletedSince(since: IsoDate) {
  return useQuery({
    queryKey: taskKeys.completedSince(since),
    queryFn: () => taskRepository.listCompletedSince(since),
  });
}
