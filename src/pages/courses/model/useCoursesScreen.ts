import { courseAccent, useCourses, type CourseWithStats } from '@entities/course';
import { useRecentUploads, useRemoveUpload, type SyllabusUpload } from '@entities/syllabus-upload';
import { useSyllabusUpload } from '@features/syllabus-upload';
import { diffInDays, formatShortDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

export interface CourseCardModel {
  id: string;
  title: string;
  code: string | null;
  accent: string;
  topicsLabel: string;
  examLabel: string | null;
}

const toCardModel = (course: CourseWithStats, today: string): CourseCardModel => ({
  id: course.id,
  title: course.name,
  code: course.code,
  accent: courseAccent(course),
  topicsLabel: course.topicCount === 0 ? 'Konu yok' : `${course.topicCount} konu`,
  examLabel: course.nextExam
    ? `${course.nextExam.title} · ${formatShortDate(course.nextExam.examDate)} (${Math.max(
        0,
        diffInDays(today, course.nextExam.examDate),
      )} gün)`
    : null,
});

export function useCoursesScreen() {
  const router = useRouter();
  const today = useToday();
  const coursesQuery = useCourses(today);
  const uploadsQuery = useRecentUploads();
  const upload = useSyllabusUpload();
  const removeUpload = useRemoveUpload();
  const [isRefreshing, setRefreshing] = useState(false);

  const courses = useMemo(
    () => (coursesQuery.data ?? []).map((course) => toCardModel(course, today)),
    [coursesQuery.data, today],
  );

  return {
    isLoading: coursesQuery.isPending && coursesQuery.data === undefined,
    error: coursesQuery.data === undefined && coursesQuery.isError ? describeError(coursesQuery.error) : null,
    retry: () => void coursesQuery.refetch(),
    isRefreshing,
    refresh: useCallback(async () => {
      setRefreshing(true);
      try {
        await Promise.all([coursesQuery.refetch(), uploadsQuery.refetch()]);
      } finally {
        setRefreshing(false);
      }
    }, [coursesQuery, uploadsQuery]),
    courses,
    openCourse: (courseId: string) => router.push(`/course/${courseId}`),
    openSchedule: () => router.push('/class-schedule'),
    openRadar: () => router.push('/review-radar'),
    uploads: uploadsQuery.data ?? [],
    onRemoveUpload: (upload: SyllabusUpload) => removeUpload.mutate(upload),
    isRemovingUpload: removeUpload.isPending,
    upload: {
      isUploading: upload.isUploading,
      onPick: upload.pickAndUpload,
      onRetry: upload.retry,
      canRetry: upload.canRetry,
      warnings: upload.result?.warnings ?? [],
      onDismissWarnings: upload.reset,
    },
  };
}
