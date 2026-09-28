import type { IsoDate } from '@contracts/enums.contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { progressRepository } from '../data/progress.repository';
import { topicRepository } from '../data/topic.repository';

export const topicKeys = {
  all: ['topics'] as const,
  forCourse: (courseId: string) => [...topicKeys.all, 'course', courseId] as const,
  radar: () => [...topicKeys.all, 'radar'] as const,
};

/** Per-course trajectory data; the maths lives in `@domain/progress`. */
export function useCourseProgress(today: IsoDate) {
  return useQuery({
    queryKey: [...topicKeys.all, 'progress', today],
    queryFn: () => progressRepository.loadCourses(today),
  });
}

export function useReviewRadar() {
  return useQuery({ queryKey: topicKeys.radar(), queryFn: () => topicRepository.listReviewRadar() });
}

export function useCourseTopics(courseId: string) {
  return useQuery({
    queryKey: topicKeys.forCourse(courseId),
    queryFn: () => topicRepository.listForCourse(courseId),
  });
}

export const topicMutationKeys = {
  setAdvancedMaterial: [...topicKeys.all, 'advanced-material'] as const,
};

export function useSetAdvancedMaterial(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: topicMutationKeys.setAdvancedMaterial,
    mutationFn: ({ topicId, hasAdvancedMaterial }: { topicId: string; hasAdvancedMaterial: boolean }) =>
      topicRepository.setAdvancedMaterial(topicId, hasAdvancedMaterial),
    onSettled: () => queryClient.invalidateQueries({ queryKey: topicKeys.forCourse(courseId) }),
  });
}
