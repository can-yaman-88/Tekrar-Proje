import { useCourse, useDeleteCourse } from '@entities/course';
import { useExamEditor } from '@features/exam-edit';
import { EXAM_KIND_LABEL, useCourseExams } from '@entities/exam';
import {
  isWeak,
  MASTERY_LABEL,
  masteryOf,
  useCourseTopics,
  useSetAdvancedMaterial,
  type Topic,
  type TopicRowModel,
} from '@entities/topic';
import { diffInDays, formatShortDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

const toRowModel = (topic: Topic, today: string): TopicRowModel => {
  const mastery = masteryOf(topic);
  const stats: string[] = [];
  if (topic.solvedProblems > 0) stats.push(`${topic.solvedProblems} problem`);
  if (topic.openTasks > 0) stats.push(`${topic.openTasks} açık görev`);

  const reviewLabel =
    topic.nextReviewOn === null
      ? null
      : topic.nextReviewOn <= today
        ? 'Tekrar zamanı geldi'
        : `Tekrar: ${formatShortDate(topic.nextReviewOn)} (${diffInDays(today, topic.nextReviewOn)} gün)`;
  const reviewIsDue = topic.nextReviewOn !== null && topic.nextReviewOn <= today;

  return {
    id: topic.id,
    title: topic.title,
    weekLabel: topic.weekNumber === null ? null : `${topic.weekNumber}. hafta`,
    mastery,
    masteryLabel: MASTERY_LABEL[mastery],
    reviewLabel,
    reviewIsDue,
    statsLabel: stats.join(' · ') || null,
    hasAdvancedMaterial: topic.hasAdvancedMaterial,
  };
};

/** Composes the course, its topics and its exams into one screen model. */
export function useCourseDetailScreen(courseId: string) {
  const router = useRouter();
  const today = useToday();
  const courseQuery = useCourse(courseId);
  const topicsQuery = useCourseTopics(courseId);
  const examsQuery = useCourseExams(courseId);
  const advancedMaterial = useSetAdvancedMaterial(courseId);
  const deleteCourse = useDeleteCourse();
  const examEditor = useExamEditor(courseId);

  const queries = [courseQuery, topicsQuery, examsQuery];
  const failed = queries.find((q) => q.isError && q.data === undefined);

  const view = useMemo(() => {
    const course = courseQuery.data;
    if (!course) return null;
    const topics = topicsQuery.data ?? [];
    const exams = examsQuery.data ?? [];

    return {
      title: course.name,
      subtitle: course.code,
      stats: [
        { label: 'konu', value: topics.length },
        { label: 'açık görev', value: topics.reduce((sum, t) => sum + t.openTasks, 0) },
        { label: 'çözülen problem', value: topics.reduce((sum, t) => sum + t.solvedProblems, 0) },
      ],
      weakTopics: topics.filter(isWeak).map((t) => toRowModel(t, today)),
      topics: topics.map((t) => toRowModel(t, today)),
      exams: exams.map((exam) => ({
        id: exam.id,
        title: exam.title,
        kindLabel: EXAM_KIND_LABEL[exam.kind],
        dateLabel: formatShortDate(exam.examDate),
        countdown: exam.examDate < today ? 'geçti' : `${Math.max(0, diffInDays(today, exam.examDate))} gün`,
        isPast: exam.examDate < today,
      })),
    };
  }, [courseQuery.data, topicsQuery.data, examsQuery.data, today]);

  return {
    isLoading: queries.some((q) => q.isPending && q.data === undefined),
    error: failed ? describeError(failed.error) : null,
    retry: () => queries.forEach((q) => void q.refetch()),
    view,
    examEditor,
    onOpenExam: (examId: string) => router.push(`/exam/${examId}`),
    onOpenTopic: (topicId: string) => router.push(`/topic/${topicId}`),
    onToggleAdvanced: (topicId: string, hasAdvancedMaterial: boolean) =>
      advancedMaterial.mutate({ topicId, hasAdvancedMaterial }),
    isTogglingAdvanced: advancedMaterial.isPending,
    onDelete: () =>
      deleteCourse.mutate(courseId, {
        onSuccess: () => {
          showToast('Ders ve ona bağlı her şey silindi.', 'success');
          router.back();
        },
        onError: (error) => showToast(describeError(error).message, 'danger'),
      }),
    isDeleting: deleteCourse.isPending,
  };
}
