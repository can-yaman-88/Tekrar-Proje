import { z } from 'zod';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SessionFormSchema = z
  .object({
    courseId: z.uuid('Ders seç.'),
    weekday: z.coerce.number().int().min(1).max(7),
    startTime: z.string().regex(TIME_PATTERN, 'Saat SS:DD biçiminde olmalı.'),
    endTime: z.string().regex(TIME_PATTERN, 'Saat SS:DD biçiminde olmalı.'),
    isLab: z.boolean(),
    location: z
      .string()
      .trim()
      .max(80, 'Çok uzun.')
      .transform((value) => (value === '' ? null : value)),
  })
  .refine((values) => values.endTime > values.startTime, {
    path: ['endTime'],
    message: 'Bitiş saati başlangıçtan sonra olmalı.',
  });

export type SessionFormValues = z.input<typeof SessionFormSchema>;
export type SessionFormOutput = z.output<typeof SessionFormSchema>;
