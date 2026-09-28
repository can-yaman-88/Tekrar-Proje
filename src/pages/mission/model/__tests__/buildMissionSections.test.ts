import type { Task } from '@entities/task';
import { buildMissionSections } from '../buildMissionSections';

const TODAY = '2026-09-23';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  type: 'problem_set',
  title: `Görev ${id}`,
  instructions: null,
  targetCount: 10,
  completedCount: 0,
  correctCount: null,
  estimatedMinutes: 60,
  dueDate: TODAY,
  startsOn: null,
  dayAllocations: null,
  parentTaskId: null,
  status: 'pending',
  confidenceLevel: null,
  source: 'manual',
  completedAt: null,
  topic: { id: `top-${id}`, title: 'Konu' },
  course: { id: 'c1', name: 'Statik', code: 'ME 201', colorHex: null },
  ...over,
});

describe('görev listesi bölümleri', () => {
  it('geciken, bugün ve bitenleri ayırır', () => {
    const { sections } = buildMissionSections(
      [
        task('geciken', { dueDate: '2026-09-20' }),
        task('bugun'),
        task('biten', { status: 'completed', completedAt: '2026-09-23T08:00:00Z' }),
      ],
      TODAY,
      new Map(),
    );
    expect(sections.map((s) => s.key)).toEqual(['overdue', 'today', 'done']);
    expect(sections[0]?.data.map((t) => t.id)).toEqual(['geciken']);
  });

  it('boş bölümler gösterilmez', () => {
    const { sections } = buildMissionSections([task('bugun')], TODAY, new Map());
    expect(sections.map((s) => s.key)).toEqual(['today']);
  });

  it('ilerleme yalnızca bugünün görevlerini sayar', () => {
    const { done, total, overdue } = buildMissionSections(
      [
        task('dun', { dueDate: '2026-09-22' }),
        task('bugun-1', { status: 'completed', completedAt: '2026-09-23T08:00:00Z' }),
        task('bugun-2'),
      ],
      TODAY,
      new Map(),
    );
    expect({ done, total, overdue }).toEqual({ done: 1, total: 2, overdue: 1 });
  });

  it('sınavı yaklaşan dersin görevi öne çıkar', () => {
    const near = task('yakin', { course: { id: 'yakin-ders', name: 'Fizik', code: 'PHYS', colorHex: null } });
    const far = task('uzak');
    const { sections } = buildMissionSections([far, near], TODAY, new Map([['yakin-ders', 1]]));
    expect(sections[0]?.data.map((t) => t.id)).toEqual(['yakin', 'uzak']);
  });
});

describe('grup görevler', () => {
  it('alt adımlar ayrı kart olmaz, ana görevin içinde görünür', () => {
    const parent = task('p', { source: 'homework', dueDate: TODAY });
    const steps = [
      task('s1', { parentTaskId: 'p', dueDate: TODAY, status: 'completed' }),
      task('s2', { parentTaskId: 'p', dueDate: TODAY }),
    ];

    const summary = buildMissionSections([parent, ...steps], TODAY, new Map());
    const cards = summary.sections.flatMap((section) => section.data);

    expect(cards.map((card) => card.id)).toEqual(['p']);
    expect(cards[0]?.subtaskProgress).toBe('1/2');
    expect(cards[0]?.subtasks.map((step) => step.id)).toEqual(['s1', 's2']);
  });

  it('ana görevi görünmeyen alt adım kendi kartını korur', () => {
    const orphan = task('s1', { parentTaskId: 'uzaktaki-ödev', dueDate: TODAY });

    const summary = buildMissionSections([orphan], TODAY, new Map());
    const cards = summary.sections.flatMap((section) => section.data);

    expect(cards.map((card) => card.id)).toEqual(['s1']);
  });
});
