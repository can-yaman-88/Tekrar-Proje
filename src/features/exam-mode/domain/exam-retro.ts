// After the exam: one question, and the topics that hurt.
//
// The answer is turned into a review schedule by the database
// (public.apply_exam_retro): an exam is the most honest recall test the app
// ever gets, so every topic it covered is moved on its result — and a topic the
// student flagged counts as failed however well the exam went overall.

export type ExamOutcome = 1 | 2 | 3 | 4 | 5;

export const EXAM_OUTCOME_LABEL: Record<ExamOutcome, string> = {
  1: 'Kötü geçti',
  2: 'Beklediğimden kötü',
  3: 'İdare eder',
  4: 'İyi geçti',
  5: 'Çok iyi geçti',
};
