import type { IsoDate } from '@contracts/enums.contract';
import { taskRepository, type Task } from '@entities/task';

/** At or above this share the topic moves on; below it, it starts over. */
export const MIXED_PASS_RATIO = 0.6;

/** What a queued "Seti bitirdim" carries; persisted as-is by the offline queue. */
export interface CompleteMixedSetVariables {
  setId: string;
  results: { taskId: string; correct: number }[];
  /** The day it was done on — a replay tomorrow still counts for today. */
  on: IsoDate;
}

export const runCompleteMixedSet = ({ setId, results, on }: CompleteMixedSetVariables) =>
  taskRepository.completeMixedSet(setId, results, on);

/** "A" from "Karışık setin A konusu: 1, 4, 6. sorular." — null for older wording. */
export function letterOf(step: Pick<Task, 'instructions'>): string | null {
  const match = /setin ([A-D]) konusu/.exec(step.instructions ?? '');
  return match?.[1] ?? null;
}

/** What a score does to the topic, in the words the sheet shows under it. */
export function scoreHint(correct: number | null, total: number): { text: string; tone: 'muted' | 'success' | 'danger' } {
  if (correct === null || total <= 0) return { text: 'Kaç doğru yaptın?', tone: 'muted' };
  const ratio = correct / total;
  const percent = Math.round(ratio * 100);
  if (ratio < MIXED_PASS_RATIO) return { text: `%${percent} · konu yarın yeniden gelir`, tone: 'danger' };
  if (ratio >= 0.9) return { text: `%${percent} · tekrar aralığı uzar`, tone: 'success' };
  return { text: `%${percent} · tekrar takviminde ilerler`, tone: 'muted' };
}
