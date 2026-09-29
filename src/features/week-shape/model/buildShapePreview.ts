import type { IsoDate } from '@contracts/enums.contract';
import type { Task } from '@entities/task';
import type { ShapeReason, WeekShapePlan } from '@domain/week-shape';
import { formatShortDate } from '@shared/lib/date';

export interface ShapePreviewRow {
  id: string;
  title: string;
  detail: string;
}

export interface ShapePreviewModel {
  moveRows: ShapePreviewRow[];
  groupRows: ShapePreviewRow[];
  /** What the tidier could not fix, in its own words. */
  notes: string[];
  summary: string;
  isEmpty: boolean;
}

/** Why a card is moving, said the way the student would say it. */
const REASON_LABEL: Record<ShapeReason, string> = {
  pair: 'konseptle aynı güne',
  quiz_after_feynman: 'Feynman’dan önceye düşmesin',
  advanced_after_quiz: 'sınavdan sonraya',
  day_cap: 'gün sınırına uysun diye',
  capacity: 'gün dolduğu için',
};

/**
 * What the tidier would do, before it does it.
 *
 * The student is being asked to approve a set of moves, so every line has to
 * say which work moves, from where to where, and — the part that earns the
 * approval — why. A card that moves for two reasons is described by the first
 * one, because that is the one that started it.
 */
export function buildShapePreview(
  plan: WeekShapePlan,
  tasks: readonly Task[],
  topicTitleById: ReadonlyMap<string, string>,
): ShapePreviewModel {
  const byId = new Map(tasks.map((task) => [task.id, task]));

  // One line per card, not per row: a learning task moving with its two steps
  // is one decision the student is making.
  const byUnit = new Map<string, { from: IsoDate; to: IsoDate; reason: ShapeReason }>();
  for (const move of plan.moves) {
    if (byUnit.has(move.unitId)) continue;
    byUnit.set(move.unitId, { from: move.from, to: move.to, reason: move.reason });
  }

  const moveRows: ShapePreviewRow[] = [...byUnit].map(([unitId, move]) => {
    const task = byId.get(unitId);
    const title = task?.title ?? 'Görev';
    return {
      id: unitId,
      title,
      detail: `${formatShortDate(move.from)} → ${formatShortDate(move.to)} · ${REASON_LABEL[move.reason]}`,
    };
  });

  const groupRows: ShapePreviewRow[] = plan.pairings.map((pairing) => ({
    id: pairing.conceptTaskId,
    title: topicTitleById.get(pairing.topicId) ?? 'Konu',
    detail: `${formatShortDate(pairing.date)} · konsept ve Feynman tek öğrenme görevinde toplanacak`,
  }));

  const parts: string[] = [];
  if (moveRows.length > 0) parts.push(`${moveRows.length} görev taşınacak`);
  if (groupRows.length > 0) parts.push(`${groupRows.length} konu tek göreve toplanacak`);

  return {
    moveRows,
    groupRows,
    notes: plan.notes,
    summary: parts.length === 0 ? 'Hafta zaten düzende görünüyor.' : `${parts.join(', ')}.`,
    isEmpty: moveRows.length === 0 && groupRows.length === 0,
  };
}
