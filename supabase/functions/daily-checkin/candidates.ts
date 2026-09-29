// Which tasks the model gets to see.
//
// A report can only touch tasks that were shown to the model, and the prompt
// has room for about a hundred. The first version took the window oldest-first
// and cut at eighty — for a student with a full week that meant a fortnight of
// finished work filled the list and NEXT week's tasks were the ones cut, so
// "bu haftaki İngilizce görevlerini sil" could not see the tasks it named.
//
// So the list is chosen, not truncated: what the report is most likely to be
// about goes in first — anything it mentions by name, then open work near the
// report day, then finished work near it (the thing a correction points at),
// then the rest of the window by distance. Cards travel whole: a step without
// its container, or a container without its steps, is a card the model cannot
// talk about properly.
import type { IsoDate, TaskStatus } from '../_shared/contracts/enums.contract.ts';
import { diffInDays } from '../_shared/domain/dates.ts';

export interface SelectableTask {
  id: string;
  parentTaskId: string | null;
  title: string;
  dueDate: IsoDate;
  status: TaskStatus;
}

/** "Near" the report: yesterday's catch-up through the coming week. */
const NEAR_BEFORE_DAYS = 2;
const NEAR_AFTER_DAYS = 7;
const OPEN: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['pending', 'in_progress']);

/** Turkish words every task title is made of; they say nothing about which task is meant. */
const COMMON_STEMS = new Set([
  'tekra', 'zayıf', 'nokta', 'konse', 'sayfa', 'feynm', 'anlat', 'sınav', 'sorul', 'sorus', 'ödevi',
  'probl', 'görev', 'hafta', 'çözme', 'ileri', 'seviy', 'çalış', 'bölüm', 'kısmı', 'hazır',
]);

/**
 * Word stems long enough to identify something. Turkish sticks its endings on
 * the word ("kafesleri", "Carnot'ta"), so five letters of the root are compared
 * rather than whole words.
 */
function stemsOf(text: string): Set<string> {
  const stems = new Set<string>();
  for (const word of text.toLocaleLowerCase('tr').split(/[^a-zçğıöşü0-9]+/)) {
    if (word.length < 5) continue;
    const stem = word.slice(0, 5);
    if (!COMMON_STEMS.has(stem)) stems.add(stem);
  }
  return stems;
}

export function selectCandidateTasks<T extends SelectableTask>({
  rows,
  logDate,
  report,
  limit,
}: {
  rows: readonly T[];
  logDate: IsoDate;
  report: string;
  limit: number;
}): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const leaderOf = (row: T): string =>
    row.parentTaskId !== null && byId.has(row.parentTaskId) ? row.parentTaskId : row.id;
  const cards = new Map<string, T[]>();
  for (const row of rows) cards.set(leaderOf(row), [...(cards.get(leaderOf(row)) ?? []), row]);

  const mentioned = stemsOf(report);
  const ranked = [...cards.entries()].map(([leader, members]) => {
    const day = byId.get(leader)?.dueDate ?? members[0]!.dueDate;
    const distance = diffInDays(logDate, day);
    const near = distance >= -NEAR_BEFORE_DAYS && distance <= NEAR_AFTER_DAYS;
    const open = members.some((member) => OPEN.has(member.status));
    const named = members.some((member) => [...stemsOf(member.title)].some((stem) => mentioned.has(stem)));
    const tier = named ? 0 : near && open ? 1 : near ? 2 : open ? 3 : 4;
    return { leader, members, tier, distance: Math.abs(distance) };
  });
  ranked.sort((a, b) => a.tier - b.tier || a.distance - b.distance || a.leader.localeCompare(b.leader));

  const chosen: T[] = [];
  for (const card of ranked) {
    if (chosen.length + card.members.length > limit) continue;
    chosen.push(...card.members);
  }

  // Back into calendar order, each card together with its container first:
  // the list is read by a model, and a list in time order is the one it reads best.
  const cardDay = (row: T): IsoDate => byId.get(leaderOf(row))?.dueDate ?? row.dueDate;
  return chosen.sort(
    (a, b) =>
      cardDay(a).localeCompare(cardDay(b)) ||
      leaderOf(a).localeCompare(leaderOf(b)) ||
      Number(a.id !== leaderOf(a)) - Number(b.id !== leaderOf(b)) ||
      a.id.localeCompare(b.id),
  );
}
