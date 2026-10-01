import type { IsoDate } from '@contracts/enums.contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { progressRepository } from '../data/progress.repository';
import { reviewRepository } from '../data/review.repository';
import { topicRepository } from '../data/topic.repository';

export const topicKeys = {
  all: ['topics'] as const,
  forCourse: (courseId: string) => [...topicKeys.all, 'course', courseId] as const,
  radar: () => [...topicKeys.all, 'radar'] as const,
  detail: (topicId: string) => [...topicKeys.all, 'detail', topicId] as const,
};

/** The review history lives apart from topics so a review can refresh both at once. */
export const reviewKeys = {
  all: ['topic-reviews'] as const,
  forTopic: (topicId: string) => [...reviewKeys.all, 'topic', topicId] as const,
  since: (since: IsoDate) => [...reviewKeys.all, 'since', since] as const,
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

/** One topic; pass null while the id is not known yet. */
export function useTopic(topicId: string | null) {
  return useQuery({
    queryKey: topicKeys.detail(topicId ?? 'none'),
    queryFn: () => topicRepository.getDetail(topicId ?? ''),
    enabled: topicId !== null,
  });
}

export function useTopicReviews(topicId: string) {
  return useQuery({ queryKey: reviewKeys.forTopic(topicId), queryFn: () => reviewRepository.listForTopic(topicId) });
}

/** Every review since a day, newest first — for "son çalışma" next to each topic in a list. */
export function useRecentReviews(since: IsoDate) {
  return useQuery({ queryKey: reviewKeys.since(since), queryFn: () => reviewRepository.listSince(since) });
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
