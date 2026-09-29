import { assertEquals } from 'jsr:@std/assert@1';
import { buildPlanRows } from './repository.ts';
import type { PlanSlot } from './planner.ts';

const slot = (over: Partial<PlanSlot> & Pick<PlanSlot, 'step' | 'type'>): PlanSlot => ({
  topicId: 'top-1',
  courseId: 'c1',
  courseLabel: 'ME 201',
  topicTitle: 'Kafes sistemler',
  targetCount: null,
  estimatedMinutes: 30,
  dueDate: '2026-10-05',
  reason: 'cycle',
  title: 'Başlık',
  instructions: 'Yönerge',
  learningGroupKey: null,
  ...over,
});

const row = (over: Partial<PlanSlot> & Pick<PlanSlot, 'step' | 'type'>) => ({
  slot: slot(over),
  title: slot(over).title,
  instructions: slot(over).instructions,
});

Deno.test('çift, kapsayıcı bir öğrenme görevi altında toplanır', () => {
  const rows = buildPlanRows([
    row({ step: 'concept_note', type: 'concept_note', learningGroupKey: 'top-1:first' }),
    row({ step: 'feynman', type: 'feynman', learningGroupKey: 'top-1:first' }),
  ]);

  assertEquals(rows.length, 3);
  const parent = rows[0];
  assertEquals(parent?.type, 'learning');
  assertEquals(parent?.parent_task_id, null);
  // Kapsayıcı dakika taşımaz: hafta görünümü hem onu hem adımlarını listeliyor.
  assertEquals(parent?.estimated_minutes, null);
  assertEquals(parent?.target_count, null);
  assertEquals(parent?.title, 'Kafes sistemler — öğrenme görevi');
  assertEquals(rows.slice(1).every((child) => child.parent_task_id === parent?.id), true);
});

Deno.test('kapsayıcının günü, adımlarının en geç günü olur', () => {
  const rows = buildPlanRows([
    row({ step: 'concept_note', type: 'concept_note', learningGroupKey: 'k', dueDate: '2026-10-05' }),
    row({ step: 'feynman', type: 'feynman', learningGroupKey: 'k', dueDate: '2026-10-07' }),
  ]);

  assertEquals(rows[0]?.due_date, '2026-10-07');
});

Deno.test('tek adımlı grup için kapsayıcı açılmaz', () => {
  const rows = buildPlanRows([row({ step: 'feynman', type: 'feynman', learningGroupKey: 'yalnız' })]);

  assertEquals(rows.length, 1);
  assertEquals(rows[0]?.parent_task_id, null);
  assertEquals(rows[0]?.type, 'feynman');
});

Deno.test('gruplanmayan adımlar tek başına kalır', () => {
  const rows = buildPlanRows([
    row({ step: 'quiz', type: 'quiz' }),
    row({ step: 'advanced_problems', type: 'advanced_problems' }),
  ]);

  assertEquals(rows.length, 2);
  assertEquals(rows.every((r) => r.parent_task_id === null), true);
});

Deno.test('her satırın kimliği benzersiz, her adımın ebeveyni listede', () => {
  const rows = buildPlanRows([
    row({ step: 'concept_note', type: 'concept_note', learningGroupKey: 'a' }),
    row({ step: 'feynman', type: 'feynman', learningGroupKey: 'a' }),
    row({ step: 'quiz', type: 'quiz' }),
  ]);

  const ids = new Set(rows.map((r) => r.id));
  assertEquals(ids.size, rows.length);
  for (const r of rows) {
    if (r.parent_task_id !== null) assertEquals(ids.has(r.parent_task_id), true);
  }
});

Deno.test('uzun konu başlığı kapsayıcı başlığında kırpılır', () => {
  const long = 'x'.repeat(300);
  const rows = buildPlanRows([
    row({ step: 'concept_note', type: 'concept_note', learningGroupKey: 'a', topicTitle: long }),
    row({ step: 'feynman', type: 'feynman', learningGroupKey: 'a', topicTitle: long }),
  ]);

  assertEquals(rows[0]?.title.length, 200);
});
