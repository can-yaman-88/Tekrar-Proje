import type { Task } from '@entities/task';
import type { WeekShapePlan } from '@domain/week-shape';
import { buildShapePreview } from '../buildShapePreview';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  type: 'feynman',
  title: 'Kafes sistemler: boş kâğıda anlat',
  instructions: null,
  targetCount: null,
  completedCount: 0,
  correctCount: null,
  estimatedMinutes: 25,
  dueDate: '2026-10-07',
  startsOn: null,
  dayAllocations: null,
  parentTaskId: null,
  status: 'pending',
  confidenceLevel: null,
  source: 'ai_weekly_plan',
  isPriority: false,
  completedAt: null,
  topic: { id: 'top', title: 'Kafes sistemler' },
  course: { id: 'c', name: 'Statik', code: 'ME 201', colorHex: null },
  ...over,
});

const plan = (over: Partial<WeekShapePlan> = {}): WeekShapePlan => ({
  moves: [],
  pairings: [],
  notes: [],
  ...over,
});

const topics = new Map([['top', 'Kafes sistemler']]);

describe('hafta düzenleme önizlemesi', () => {
  it('taşınan her kart için bir satır üretir ve sebebini söyler', () => {
    const preview = buildShapePreview(
      plan({
        moves: [{ taskId: 't1', unitId: 't1', from: '2026-10-07', to: '2026-10-05', reason: 'pair' }],
      }),
      [task()],
      topics,
    );

    expect(preview.moveRows).toHaveLength(1);
    expect(preview.moveRows[0]?.title).toBe('Kafes sistemler: boş kâğıda anlat');
    expect(preview.moveRows[0]?.detail).toContain('konseptle aynı güne');
    expect(preview.isEmpty).toBe(false);
  });

  it('bir kartın adımları tek satırda toplanır', () => {
    const preview = buildShapePreview(
      plan({
        moves: [
          { taskId: 'parent', unitId: 'parent', from: '2026-10-07', to: '2026-10-05', reason: 'day_cap' },
          { taskId: 'step-1', unitId: 'parent', from: '2026-10-07', to: '2026-10-05', reason: 'day_cap' },
          { taskId: 'step-2', unitId: 'parent', from: '2026-10-07', to: '2026-10-05', reason: 'day_cap' },
        ],
      }),
      [task({ id: 'parent', type: 'learning', title: 'Kafes sistemler — öğrenme görevi' })],
      topics,
    );

    expect(preview.moveRows).toHaveLength(1);
    expect(preview.moveRows[0]?.detail).toContain('gün sınırına uysun diye');
  });

  it('birleşecek çiftleri ayrı listeler', () => {
    const preview = buildShapePreview(
      plan({
        pairings: [
          { topicId: 'top', conceptTaskId: 'c1', feynmanTaskId: 'f1', date: '2026-10-05' },
        ],
      }),
      [task()],
      topics,
    );

    expect(preview.groupRows).toHaveLength(1);
    expect(preview.groupRows[0]?.title).toBe('Kafes sistemler');
    expect(preview.summary).toContain('1 konu tek göreve toplanacak');
  });

  it('yapılacak bir şey yoksa boş olduğunu söyler', () => {
    const preview = buildShapePreview(plan(), [task()], topics);

    expect(preview.isEmpty).toBe(true);
    expect(preview.summary).toBe('Hafta zaten düzende görünüyor.');
  });

  it('çözülemeyenleri olduğu gibi aktarır', () => {
    const preview = buildShapePreview(plan({ notes: ['Sınav için gün kalmadı.'] }), [task()], topics);

    expect(preview.notes).toEqual(['Sınav için gün kalmadı.']);
  });
});
