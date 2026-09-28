import { z } from 'zod';

export const ExamFormSchema = z.object({
  kind: z.enum(['midterm', 'final', 'quiz', 'other']),
  title: z.string().trim().min(2, 'En az 2 karakter.').max(120, 'Çok uzun.'),
  examDate: z.iso.date('Tarih YYYY-AA-GG biçiminde olmalı.'),
});

export type ExamFormValues = z.input<typeof ExamFormSchema>;
export type ExamFormOutput = z.output<typeof ExamFormSchema>;
