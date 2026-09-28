import { z } from 'zod';
import { ExamKindSchema } from './enums.contract.ts';

// ---------------------------------------------------------------------------
// Client ⇄ Edge Function
// ---------------------------------------------------------------------------
export const SyllabusIngestRequestSchema = z.object({
  uploadId: z.uuid(),
});
export type SyllabusIngestRequest = z.infer<typeof SyllabusIngestRequestSchema>;

export const SyllabusIngestResponseSchema = z.object({
  uploadId: z.uuid(),
  courseId: z.uuid(),
  courseName: z.string(),
  topicsAdded: z.number().int(),
  examsAdded: z.number().int(),
  /** Things the parser dropped or could not read — shown to the user. */
  warnings: z.array(z.string()),
});
export type SyllabusIngestResponse = z.infer<typeof SyllabusIngestResponseSchema>;

// ---------------------------------------------------------------------------
// LLM structured output (no constraint keywords — see llm/json-schema.ts)
// ---------------------------------------------------------------------------
export const SyllabusExtractionSchema = z.object({
  course: z.object({
    name: z.string().describe('Course name as written in the syllabus, e.g. "Thermodynamics".'),
    code: z.string().nullable().describe('Course code such as "ME 204", else null.'),
    termStartDate: z
      .string()
      .nullable()
      .describe(
        'YYYY-MM-DD of the FIRST teaching week, when the schedule dates its weeks ' +
          '("Week 1 (Sep 28)"). null when the document gives no dates at all.',
      ),
  }),
  topics: z
    .array(
      z.object({
        title: z.string().describe('One week-by-week topic, e.g. "Carnot cycle and entropy".'),
        weekNumber: z.number().int().nullable().describe('Week number in the schedule, else null.'),
      }),
    )
    .describe('Week-by-week schedule, in document order.'),
  exams: z.array(
    z.object({
      kind: ExamKindSchema,
      title: z.string().describe('e.g. "Midterm 1".'),
      date: z
        .string()
        .nullable()
        .describe('Exam date as YYYY-MM-DD. Use the academic year implied by the document. null if absent.'),
      weekNumber: z
        .number()
        .int()
        .nullable()
        .describe(
          'Week number when the syllabus places the exam by week instead of a date ' +
            '("Midterm: 8. hafta"). null when a real date is given.',
        ),
      weightPercent: z.number().nullable().describe('Share of the final grade, 0–100, else null.'),
      coversWeeks: z.array(z.number().int()).describe('Week numbers the exam covers, empty if not stated.'),
    }),
  ),
});
export type SyllabusExtraction = z.infer<typeof SyllabusExtractionSchema>;
