import { assertEquals } from 'jsr:@std/assert@1';
import { addDaysUtc, buildTaskList, sumByTask, type OpenTaskRow } from './subjects.ts';

const row = (over: Partial<OpenTaskRow> & { id: string }): OpenTaskRow => ({
  topic_id: 'topic-1',
  parent_task_id: null,
  title: 'Görev',
  type: 'quiz',
  due_date: '2026-10-02',
  estimated_minutes: 30,
  ...over,
});

Deno.test('containers are left out; their steps carry the container title', () => {
  const list = buildTaskList(
    [
      row({ id: 'group', title: 'Kafes sistemler öğrenme', type: 'learning' }),
      row({ id: 'step', title: 'Feynman sayfası', parent_task_id: 'group', type: 'feynman' }),
      row({ id: 'single', title: '10 soruluk sınav', due_date: '2026-10-01' }),
    ],
    new Set(['group']),
    new Map([['group', 'Kafes sistemler öğrenme']]),
    new Map([['step', 25]]),
  );
  assertEquals(
    list.map((task) => [task.id, task.parentTitle, task.measuredMinutes]),
    [
      ['single', null, 0],
      ['step', 'Kafes sistemler öğrenme', 25],
    ],
  );
});

Deno.test('minutes add up from both clocks and skip rows without a task', () => {
  const totals = sumByTask([
    { task_id: 'a', minutes: 20 },
    { task_id: 'a', minutes: 15 },
    { task_id: null, minutes: 50 },
    { task_id: 'b', minutes: null },
  ]);
  assertEquals([...totals.entries()], [['a', 35]]);
});

Deno.test('day arithmetic crosses months', () => {
  assertEquals(addDaysUtc('2026-10-02', -42), '2026-08-21');
  assertEquals(addDaysUtc('2026-10-02', 30), '2026-11-01');
});
