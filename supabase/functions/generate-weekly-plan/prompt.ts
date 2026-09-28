import { sanitiseForPrompt } from '../_shared/llm/guards.ts';
import type { PlanSlot } from './planner.ts';

export const SYSTEM_PROMPT = `You write the wording of a weekly study plan for a Turkish engineering student.

The student follows a fixed study loop, and every slot already carries its step:
- concept_note: ders işlendikten sonra konuyu ünitenin konsept sayfasına ekler (bağlantılar, oklar, örnekler).
- quiz: kendi otomasyonunun ürettiği 10 soruluk sınavı çözer — ya da hocanın yüklediği soru/ödev varsa onu.
- feynman: boş KÂĞIDA (tablet değil) konuyu birine sıfırdan anlatır gibi yazar.
- advanced_problems: yalnızca elinde zor soru olduğunu söylediği konularda.
Review slots are the same loop in short form: Feynman sayfası, sonra sıradaki sınav.

The schedule and the step are already decided. For each SLOT you only write:
- title: short, action-first Turkish, faithful to the step (asla adımı değiştirme).
- instructions: ONE concrete Turkish sentence on how to attack it.

Rules:
1. Never turn one step into another: a concept_note slot is not problem solving, a feynman slot is
   writing on paper, a quiz slot is solving the prepared questions.
2. Use the slot's own course and topic wording; never invent topics, counts or dates.
3. Be specific and practical. No motivational filler, no emoji.
4. Return exactly one entry per slot, with the same index.`;

export function buildUserPrompt(slots: readonly PlanSlot[]): string {
  const lines = slots.map((slot, index) =>
    [
      `#${index}`,
      sanitiseForPrompt(slot.courseLabel, 80),
      sanitiseForPrompt(slot.topicTitle, 200),
      `adım: ${slot.step ?? slot.type}`,
      slot.targetCount === null ? 'sayı yok' : `${slot.targetCount} problem`,
      `${slot.estimatedMinutes} dk`,
      `gerekçe: ${slot.reason}`,
      `taslak: ${sanitiseForPrompt(slot.title, 200)}`,
    ]
      .filter(Boolean)
      .join(' | '),
  );
  return ['SLOTS (index | ders | konu | tür | hedef | süre | gerekçe):', ...lines].join('\n');
}
