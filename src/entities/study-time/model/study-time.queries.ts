import type { IsoDate } from '@contracts/enums.contract';
import { useQuery } from '@tanstack/react-query';
import { studyTimeRepository } from '../data/study-time.repository';

export const studyTimeKeys = {
  all: ['study-time'] as const,
  since: (from: IsoDate) => [...studyTimeKeys.all, 'since', from] as const,
  course: (courseId: string) => [...studyTimeKeys.all, 'course', courseId] as const,
  topic: (topicId: string) => [...studyTimeKeys.all, 'topic', topicId] as const,
};

/** Every course's study time since a day — the weekly summary's per-course view. */
export function useStudyTimeSince(from: IsoDate) {
  return useQuery({
    queryKey: studyTimeKeys.since(from),
    queryFn: () => studyTimeRepository.list({ from }),
  });
}

/** All the time that went into one course, for its topic breakdown. */
export function useCourseStudyTime(courseId: string) {
  return useQuery({
    queryKey: studyTimeKeys.course(courseId),
    queryFn: () => studyTimeRepository.list({ courseId }),
  });
}

export function useTopicStudyTime(topicId: string) {
  return useQuery({
    queryKey: studyTimeKeys.topic(topicId),
    queryFn: () => studyTimeRepository.list({ topicId }),
  });
}
