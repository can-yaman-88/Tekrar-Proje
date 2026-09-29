import { z } from 'zod';
import { IsoDateSchema, StudyStepSchema, TaskTypeSchema } from './enums.contract.ts';

// ---------------------------------------------------------------------------
// Client ⇄ Edge Function
// ---------------------------------------------------------------------------
export const WeeklyPlanRequestSchema = z.object({
  /** Defaults to the caller's current week (Monday). */
  weekStart: IsoDateSchema.optional(),
  /**
   * The phone's own date. Planning starts here, so a plan made mid-week never
   * lands on a day already behind; the server's UTC date is only a fallback,
   * and near midnight in Turkey it is still yesterday.
   */
  today: IsoDateSchema.optional(),
  /** Only honoured for service-role callers (the cron job). */
  userId: z.uuid().optional(),
});
export type WeeklyPlanRequest = z.infer<typeof WeeklyPlanRequestSchema>;

export const WeeklyPlanTaskSchema = z.object({
  title: z.string(),
  type: TaskTypeSchema,
  step: StudyStepSchema,
  dueDate: IsoDateSchema,
  courseLabel: z.string(),
  topicTitle: z.string(),
  estimatedMinutes: z.number().int().nullable(),
});

export const WeeklyPlanResponseSchema = z.object({
  weekStart: IsoDateSchema,
  weekEnd: IsoDateSchema,
  created: z.number().int(),
  replaced: z.number().int(),
  tasks: z.array(WeeklyPlanTaskSchema),
  /** e.g. "no topics to schedule", "capacity full" */
  notes: z.array(z.string()),
  /** Minutes budgeted per ISO weekday (1 = Monday) for this plan. */
  capacityByWeekday: z.record(z.string(), z.number()),
  /** Weekdays whose budget came from real history rather than the default. */
  learnedWeekdays: z.array(z.number().int()),
});
export type WeeklyPlanResponse = z.infer<typeof WeeklyPlanResponseSchema>;

// ---------------------------------------------------------------------------
// LLM phrasing only. The schedule itself is decided by code; the model just
// writes the Turkish title and a one-line instruction for each chosen slot.
// ---------------------------------------------------------------------------
export const PlanPhrasingSchema = z.object({
  tasks: z.array(
    z.object({
      index: z.number().int().describe('Index of the slot being phrased, copied from the SLOTS list.'),
      title: z.string().describe('Short, action-first Turkish title, e.g. "Kafes sistemlerden 15 problem çöz".'),
      instructions: z.string().describe('One concrete sentence in Turkish on how to attack it.'),
    }),
  ),
});
export type PlanPhrasing = z.infer<typeof PlanPhrasingSchema>;
