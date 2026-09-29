// Runtime mirrors of the Postgres enums. `db-parity.ts` fails compilation if
// these ever drift from the generated Database types.
import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'rescheduled',
  'skipped',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskTypeSchema = z.enum([
  // The student's own study loop.
  'concept_note', // konsept sayfasına ekleme
  'quiz', // 10 soruluk otomasyon sınavı ya da hocanın materyali
  'feynman', // boş kâğıda sıfırdan anlatma
  'advanced_problems', // yalnızca elinde zor soru olduğunu söylediğinde
  // The container that holds one topic's concept page and Feynman page: one
  // sitting, one card. Deliberately NOT a study step — see StudyStepSchema.
  'learning',
  // Older / generic kinds, still produced by check-in reschedules.
  'problem_set',
  'concept_review',
  'derivation',
  'spaced_review',
  'mock_exam',
]);

/** The ordered loop the student follows for a freshly taught topic. */
export const StudyStepSchema = z.enum(['concept_note', 'quiz', 'feynman', 'advanced_problems']);
export type StudyStep = z.infer<typeof StudyStepSchema>;
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskSourceSchema = z.enum([
  'manual',
  'ai_weekly_plan',
  'ai_checkin_reschedule',
  'spaced_repetition',
  'ai_attachment',
  'exam_cram',
  'homework',
]);
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const ExamKindSchema = z.enum(['quiz', 'midterm', 'final', 'lab', 'other']);
export type ExamKind = z.infer<typeof ExamKindSchema>;

export const ProcessingStatusSchema = z.enum(['pending', 'processing', 'succeeded', 'failed']);
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;

/** File kinds a check-in may carry. */
export const AttachmentMimeSchema = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export type AttachmentMime = z.infer<typeof AttachmentMimeSchema>;

/** Calendar date in the user's local timezone, `YYYY-MM-DD`. */
export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;
