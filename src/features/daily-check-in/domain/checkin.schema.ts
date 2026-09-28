import { z } from 'zod';

export const CHECKIN_MAX_LENGTH = 4000;

export const CheckinFormSchema = z.object({
  report: z
    .string()
    .trim()
    .min(10, 'Tell me a bit more — at least a sentence.')
    .max(CHECKIN_MAX_LENGTH, `Keep it under ${CHECKIN_MAX_LENGTH} characters.`),
});

export type CheckinFormValues = z.infer<typeof CheckinFormSchema>;
