import type { IsoDate } from '@contracts/enums.contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { courseRepository } from '../data/course.repository';

export const courseKeys = {
  all: ['courses'] as const,
  withStats: (today: IsoDate) => [...courseKeys.all, 'stats', today] as const,
  detail: (courseId: string) => [...courseKeys.all, 'detail', courseId] as const,
  terms: () => [...courseKeys.all, 'terms'] as const,
};

export function useCourse(courseId: string) {
  return useQuery({
    queryKey: courseKeys.detail(courseId),
    queryFn: () => courseRepository.getById(courseId),
  });
}

export function useCourses(today: IsoDate) {
  return useQuery({
    queryKey: courseKeys.withStats(today),
    queryFn: () => courseRepository.listWithStats(today),
    staleTime: 5 * 60_000,
  });
}

/** Week 1 of every course, for "bu hafta dönemin kaçıncı haftası". */
export function useCourseTerms() {
  return useQuery({ queryKey: courseKeys.terms(), queryFn: () => courseRepository.listTerms() });
}

export const courseMutationKeys = {
  remove: [...courseKeys.all, 'delete'] as const,
  termStart: [...courseKeys.all, 'term-start'] as const,
};

export function useSetTermStart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: courseMutationKeys.termStart,
    mutationFn: ({ courseIds, termStartDate }: { courseIds: readonly string[]; termStartDate: string }) =>
      courseRepository.setTermStart(courseIds, termStartDate),
    onSettled: () => queryClient.invalidateQueries({ queryKey: courseKeys.all }),
  });
}

export function useDeleteCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: courseMutationKeys.remove,
    mutationFn: (courseId: string) => courseRepository.remove(courseId),
    // Tasks, topics, exams and timetable rows go with it, so refresh everything.
    onSettled: () => queryClient.invalidateQueries(),
  });
}
