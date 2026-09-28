// Am I on track?
//
// Every other screen answers "what now" — today, this week, this topic. None
// of them answers the question a student actually loses sleep over three weeks
// before a midterm: at this pace, will I be ready?
//
// The answer is arithmetic, not encouragement: how many topics are finished,
// how many remain, how fast they have been getting finished, and what that
// rate implies for the days left. Where the numbers are too thin to say
// anything, it says that instead of guessing.
import type { IsoDate, StudyStep } from '../contracts/enums.contract.ts';
import { diffInDays } from './dates.ts';

export interface ProgressTopic {
  id: string;
  /** Study steps completed for this topic. */
  completedSteps: readonly StudyStep[];
  /** When its loop was finished, if it was. */
  finishedOn: IsoDate | null;
}

export interface ProgressCourse {
  courseId: string;
  courseLabel: string;
  topics: readonly ProgressTopic[];
  /** The next exam for this course, if any. */
  nextExam: { title: string; date: IsoDate; topicIds: readonly string[] } | null;
  /** Correct answers over attempted, across the course's finished quizzes. */
  accuracy: { correct: number; attempted: number } | null;
}

export type Verdict = 'ahead' | 'on_track' | 'behind' | 'unknown' | 'no_exam';

export interface CourseProgress {
  courseId: string;
  courseLabel: string;
  totalTopics: number;
  finishedTopics: number;
  startedTopics: number;
  /** 0–1, of the course's topics. */
  coverage: number;
  accuracyPercent: number | null;
  exam: {
    title: string;
    date: IsoDate;
    daysLeft: number;
    topicsInScope: number;
    topicsReady: number;
    /** False when the exam lists no topics and the whole course was assumed. */
    scopeIsStated: boolean;
  } | null;
  /** Topics finished per week, measured over the recent past. */
  observedPace: number | null;
  /** Topics per week needed to be ready in time. */
  requiredPace: number | null;
  verdict: Verdict;
  message: string;
}

/** The window the observed pace is measured over. */
const PACE_WINDOW_DAYS = 21;
/** Below this many finished topics the pace means nothing. */
const MIN_PACE_SAMPLES = 2;
/** A loop counts as finished when these are all done. */
const LOOP: readonly StudyStep[] = ['concept_note', 'feynman', 'quiz'];

const isFinished = (topic: ProgressTopic): boolean => LOOP.every((step) => topic.completedSteps.includes(step));
const isStarted = (topic: ProgressTopic): boolean =>
  !isFinished(topic) && topic.completedSteps.length > 0;

export function buildCourseProgress(course: ProgressCourse, today: IsoDate): CourseProgress {
  const total = course.topics.length;
  const finished = course.topics.filter(isFinished);
  const started = course.topics.filter(isStarted);

  const recentlyFinished = finished.filter(
    (topic) => topic.finishedOn !== null && diffInDays(topic.finishedOn, today) <= PACE_WINDOW_DAYS,
  );
  const observedPace =
    recentlyFinished.length >= MIN_PACE_SAMPLES ? (recentlyFinished.length * 7) / PACE_WINDOW_DAYS : null;

  const accuracyPercent =
    course.accuracy === null || course.accuracy.attempted === 0
      ? null
      : Math.round((course.accuracy.correct / course.accuracy.attempted) * 100);

  const exam = course.nextExam;
  if (exam === null) {
    return {
      courseId: course.courseId,
      courseLabel: course.courseLabel,
      totalTopics: total,
      finishedTopics: finished.length,
      startedTopics: started.length,
      coverage: total === 0 ? 0 : finished.length / total,
      accuracyPercent,
      exam: null,
      observedPace,
      requiredPace: null,
      verdict: 'no_exam',
      message:
        total === 0
          ? 'Bu derste konu yok.'
          : `${finished.length}/${total} konu hazır. Sınav tarihi girilmemiş.`,
    };
  }

  // A topic is "in scope" when the exam lists it; an exam that lists nothing
  // is assumed to cover the course.
  const scopeIds = exam.topicIds.length > 0 ? new Set(exam.topicIds) : null;
  const inScope = scopeIds === null ? course.topics : course.topics.filter((topic) => scopeIds.has(topic.id));
  const readyInScope = inScope.filter(isFinished).length;
  const remaining = inScope.length - readyInScope;
  const daysLeft = diffInDays(today, exam.date);
  const weeksLeft = Math.max(0.5, daysLeft / 7);
  const requiredPace = daysLeft < 0 ? null : remaining / weeksLeft;

  const verdict = decideVerdict({ daysLeft, remaining, observedPace, requiredPace });

  return {
    courseId: course.courseId,
    courseLabel: course.courseLabel,
    totalTopics: total,
    finishedTopics: finished.length,
    startedTopics: started.length,
    coverage: total === 0 ? 0 : finished.length / total,
    accuracyPercent,
    exam: {
      title: exam.title,
      date: exam.date,
      daysLeft,
      topicsInScope: inScope.length,
      topicsReady: readyInScope,
      scopeIsStated: scopeIds !== null,
    },
    observedPace,
    requiredPace,
    verdict,
    message:
      verdictMessage({ verdict, daysLeft, remaining, observedPace, requiredPace, examTitle: exam.title }) +
      // Without a stated scope the whole course is counted, which can make the
      // required pace look absurd. Say so rather than let the number mislead.
      (scopeIds === null && inScope.length > 0
        ? ' Sınav kapsamı girilmediği için dersin tamamı sayıldı.'
        : ''),
  };
}

function decideVerdict({
  daysLeft,
  remaining,
  observedPace,
  requiredPace,
}: {
  daysLeft: number;
  remaining: number;
  observedPace: number | null;
  requiredPace: number | null;
}): Verdict {
  if (daysLeft < 0) return 'no_exam';
  if (remaining === 0) return 'ahead';
  if (observedPace === null || requiredPace === null) return 'unknown';
  if (observedPace >= requiredPace * 1.15) return 'ahead';
  if (observedPace >= requiredPace * 0.85) return 'on_track';
  return 'behind';
}

const round1 = (value: number): string => (Math.round(value * 10) / 10).toString();

function verdictMessage({
  verdict,
  daysLeft,
  remaining,
  observedPace,
  requiredPace,
  examTitle,
}: {
  verdict: Verdict;
  daysLeft: number;
  remaining: number;
  observedPace: number | null;
  requiredPace: number | null;
  examTitle: string;
}): string {
  const when = daysLeft === 0 ? 'bugün' : `${daysLeft} gün sonra`;
  if (verdict === 'no_exam') return `${examTitle} geçti.`;
  if (remaining === 0) return `${examTitle} ${when}: kapsamdaki konuların hepsi hazır.`;
  if (verdict === 'unknown') {
    return `${examTitle} ${when}: ${remaining} konu kaldı, haftada ${round1(requiredPace ?? 0)} konu gerekiyor. Hız için yeterli geçmiş yok.`;
  }

  const pace = `şu anki hızın haftada ${round1(observedPace ?? 0)}, gereken ${round1(requiredPace ?? 0)}`;
  if (verdict === 'ahead') return `${examTitle} ${when}: ${remaining} konu kaldı, öndesin (${pace}).`;
  if (verdict === 'on_track') return `${examTitle} ${when}: ${remaining} konu kaldı, bu hızla yetişir (${pace}).`;
  return `${examTitle} ${when}: ${remaining} konu kaldı, bu hızla yetişmez (${pace}).`;
}

export { LOOP as PROGRESS_LOOP, PACE_WINDOW_DAYS };
