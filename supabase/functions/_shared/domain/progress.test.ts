import { assertEquals } from 'jsr:@std/assert@1';
import { buildCourseProgress, type ProgressCourse, type ProgressTopic } from './progress.ts';

const TODAY = '2026-09-28';

const topic = (id: string, over: Partial<ProgressTopic> = {}): ProgressTopic => ({
  id,
  completedSteps: [],
  finishedOn: null,
  ...over,
});

const finished = (id: string, on: string): ProgressTopic =>
  topic(id, { completedSteps: ['concept_note', 'feynman', 'quiz'], finishedOn: on });

const course = (over: Partial<ProgressCourse> = {}): ProgressCourse => ({
  courseId: 'c1',
  courseLabel: 'ME201',
  topics: [],
  nextExam: null,
  accuracy: null,
  ...over,
});

Deno.test('sınav yoksa yalnızca kapsama bildirilir', () => {
  const result = buildCourseProgress(
    course({ topics: [finished('a', '2026-09-20'), topic('b')] }),
    TODAY,
  );

  assertEquals(result.verdict, 'no_exam');
  assertEquals(result.finishedTopics, 1);
  assertEquals(result.coverage, 0.5);
});

Deno.test('yeterli geçmiş yoksa hız bilinmiyor denir, uydurulmaz', () => {
  const result = buildCourseProgress(
    course({
      topics: [finished('a', '2026-09-20'), topic('b'), topic('c')],
      nextExam: { title: 'Vize 1', date: '2026-10-19', topicIds: [] },
    }),
    TODAY,
  );

  assertEquals(result.verdict, 'unknown');
  assertEquals(result.observedPace, null);
  assertEquals(result.message.includes('yeterli geçmiş yok'), true);
});

Deno.test('hız yetiyorsa yolunda, yetmiyorsa geride der', () => {
  const fast = buildCourseProgress(
    course({
      // Son üç haftada altı konu bitmiş: haftada 2.
      topics: [
        finished('a', '2026-09-10'),
        finished('b', '2026-09-12'),
        finished('c', '2026-09-15'),
        finished('d', '2026-09-18'),
        finished('e', '2026-09-22'),
        finished('f', '2026-09-25'),
        topic('g'),
        topic('h'),
      ],
      nextExam: { title: 'Vize', date: '2026-10-12', topicIds: [] },
    }),
    TODAY,
  );
  assertEquals(fast.verdict === 'ahead' || fast.verdict === 'on_track', true);

  const slow = buildCourseProgress(
    course({
      topics: [
        finished('a', '2026-09-10'),
        finished('b', '2026-09-24'),
        ...Array.from({ length: 10 }, (_, i) => topic(`t${i}`)),
      ],
      nextExam: { title: 'Vize', date: '2026-10-05', topicIds: [] },
    }),
    TODAY,
  );
  assertEquals(slow.verdict, 'behind');
  assertEquals(slow.message.includes('yetişmez'), true);
});

Deno.test('sınav kapsamı belirtilmişse yalnızca o konular sayılır', () => {
  const result = buildCourseProgress(
    course({
      topics: [finished('a', '2026-09-20'), topic('b'), topic('c')],
      nextExam: { title: 'Vize', date: '2026-10-12', topicIds: ['a', 'b'] },
    }),
    TODAY,
  );

  assertEquals(result.exam?.topicsInScope, 2);
  assertEquals(result.exam?.topicsReady, 1);
});

Deno.test('kapsamdaki her şey bittiyse öndesin', () => {
  const result = buildCourseProgress(
    course({
      topics: [finished('a', '2026-09-20'), topic('b')],
      nextExam: { title: 'Vize', date: '2026-10-12', topicIds: ['a'] },
    }),
    TODAY,
  );

  assertEquals(result.verdict, 'ahead');
  assertEquals(result.message.includes('hepsi hazır'), true);
});

Deno.test('isabet oranı yüzdeye çevrilir', () => {
  const result = buildCourseProgress(course({ accuracy: { correct: 27, attempted: 40 } }), TODAY);
  assertEquals(result.accuracyPercent, 68);
});

Deno.test('kapsam girilmemişse bu açıkça söylenir', () => {
  const stated = buildCourseProgress(
    course({
      topics: [finished('a', '2026-09-20'), topic('b')],
      nextExam: { title: 'Vize', date: '2026-10-12', topicIds: ['a', 'b'] },
    }),
    TODAY,
  );
  const assumed = buildCourseProgress(
    course({
      topics: [finished('a', '2026-09-20'), topic('b')],
      nextExam: { title: 'Vize', date: '2026-10-12', topicIds: [] },
    }),
    TODAY,
  );

  assertEquals(stated.exam?.scopeIsStated, true);
  assertEquals(stated.message.includes('kapsamı girilmediği'), false);
  assertEquals(assumed.exam?.scopeIsStated, false);
  assertEquals(assumed.message.includes('kapsamı girilmediği'), true);
});
