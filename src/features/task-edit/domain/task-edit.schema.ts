import { z } from 'zod';

const optionalNumber = (max: number) =>
  z
    .union([z.literal(''), z.coerce.number().int().min(0).max(max)])
    .transform((value) => (value === '' ? null : value));

/** The title stays as written by the planner; everything else is editable. */
export const TaskEditSchema = z.object({
  // Whatever a task was created as, editing it puts it under one of the three
  // labels the student actually uses.
  type: z.enum(['concept_note', 'quiz', 'feynman']),
  instructions: z
    .string()
    .trim()
    .max(2000, 'En fazla 2000 karakter.')
    .transform((value) => (value === '' ? null : value)),
  dueDate: z.iso.date('Tarih YYYY-AA-GG biçiminde olmalı.'),
  /** Empty means "decide for me": the window opens a week before the deadline. */
  startsOn: z.union([z.literal(''), z.iso.date('Tarih YYYY-AA-GG biçiminde olmalı.')]).transform((value) =>
    value === '' ? null : value,
  ),
  targetCount: optionalNumber(9999),
  completedCount: z.coerce.number().int().min(0).max(9999),
  estimatedMinutes: optionalNumber(600),
})
  .refine((values) => values.startsOn === null || values.startsOn <= values.dueDate, {
    path: ['startsOn'],
    message: 'Başlama günü teslim tarihinden sonra olamaz.',
  });

export type TaskEditValues = z.input<typeof TaskEditSchema>;
export type TaskEditOutput = z.output<typeof TaskEditSchema>;
