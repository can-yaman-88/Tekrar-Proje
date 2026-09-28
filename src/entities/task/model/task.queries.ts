import type { IsoDate } from '@contracts/enums.contract';
import { useQuery } from '@tanstack/react-query';
import { taskRepository } from '../data/task.repository';
import { taskKeys } from './task.keys';

export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => taskRepository.getById(taskId),
  });
}

export function useFinishedTasks() {
  return useQuery({
    queryKey: taskKeys.history(),
    queryFn: () => taskRepository.listFinished(),
  });
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
