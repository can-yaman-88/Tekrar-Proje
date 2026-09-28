import type { IsoDate } from '@contracts/enums.contract';
import { useQuery } from '@tanstack/react-query';
import { examRepository } from '../data/exam.repository';

export const examKeys = {
  all: ['exams'] as const,
  upcoming: (today: IsoDate) => [...examKeys.all, 'upcoming', today] as const,
  forCourse: (courseId: string) => [...examKeys.all, 'course', courseId] as const,
};

export function useCourseExams(courseId: string) {
  return useQuery({
    queryKey: examKeys.forCourse(courseId),
    queryFn: () => examRepository.listForCourse(courseId),
  });
}

export function useUpcomingExams(today: IsoDate) {
  return useQuery({
    queryKey: examKeys.upcoming(today),
    queryFn: () => examRepository.listUpcoming(today),
    staleTime: 10 * 60_000, // exam dates rarely change
  });
}
