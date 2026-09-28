import { z } from 'zod';

export const NOTE_MAX_LENGTH = 2000;

export const NoteFormSchema = z.object({
  body: z.string().trim().min(2, 'Biraz daha yaz.').max(NOTE_MAX_LENGTH, 'Çok uzun.'),
});

export type NoteFormValues = z.infer<typeof NoteFormSchema>;
