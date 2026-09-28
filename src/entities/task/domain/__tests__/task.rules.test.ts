import { TASK_GROUP_LABEL, isDeadlineWork, isOpen, isOverdue, nextStatusOnToggle, priorityScore, progressRatio, taskGroupOf, withStatus } from '../task.rules';
import type { Task } from '../task.types';

const TODAY = '2026-09-23';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  type: 'problem_set',
  title: 'Kafes problemleri',
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
  topic: { id: 'top', title: 'Kafes' },
  course: { id: 'c', name: 'Statik', code: 'ME 201', colorHex: null },
  ...over,
});

describe('görev kuralları', () => {
  it('yalnızca açık görevler gecikmiş sayılır', () => {
    expect(isOverdue(task({ dueDate: '2026-09-21' }), TODAY)).toBe(true);
    expect(isOverdue(task({ dueDate: '2026-09-24' }), TODAY)).toBe(false);
    // Biten iş gecikmiş değildir.
    expect(isOverdue(task({ dueDate: '2026-09-21', status: 'completed' }), TODAY)).toBe(false);
    expect(isOpen(task({ status: 'in_progress' }))).toBe(true);
  });

  it('ilerleme oranı hedefe göre hesaplanır, tamamlanan her zaman tamdır', () => {
    expect(progressRatio(task({ completedCount: 5 }))).toBe(0.5);
    expect(progressRatio(task({ completedCount: 20 }))).toBe(1); // hedefi aşmak taşmaz
    expect(progressRatio(task({ targetCount: null }))).toBe(0);
    expect(progressRatio(task({ status: 'completed', targetCount: null }))).toBe(1);
  });

  it('işaretleme durumu ileri geri çevirir ve ilerlemeyi korur', () => {
    expect(nextStatusOnToggle(task())).toBe('completed');
    expect(nextStatusOnToggle(task({ status: 'completed', completedCount: 0 }))).toBe('pending');
    expect(nextStatusOnToggle(task({ status: 'completed', completedCount: 4 }))).toBe('in_progress');
  });

  it('tamamlanma damgası yalnızca tamamlanınca durur', () => {
    const now = new Date('2026-09-23T10:00:00Z');
    expect(withStatus(task(), 'completed', now).completedAt).toBe(now.toISOString());
    expect(withStatus(task({ status: 'completed', completedAt: now.toISOString() }), 'pending').completedAt).toBeNull();
  });

  it('öncelik gecikmeyi, sınav yakınlığını ve düşük güveni birlikte tartar', () => {
    const overdue = priorityScore(task({ dueDate: '2026-09-20' }), TODAY, null);
    const today = priorityScore(task(), TODAY, null);
    expect(overdue).toBeGreaterThan(today);

    const nearExam = priorityScore(task(), TODAY, 2);
    expect(nearExam).toBeGreaterThan(today);

    const lowConfidence = priorityScore(task({ confidenceLevel: 1 }), TODAY, null);
    expect(lowConfidence).toBeGreaterThan(today);
  });
});

describe('ödev ayrımı', () => {
  it('ödevi kaynağından tanır, türünden değil', () => {
    expect(taskGroupOf(task({ type: 'problem_set', source: 'ai_weekly_plan' }))).toBe('quiz');
    expect(taskGroupOf(task({ type: 'problem_set', source: 'homework' }))).toBe('homework');
    expect(taskGroupOf(task({ type: 'quiz', source: 'ai_attachment' }))).toBe('homework');
  });

  it('teslimli iş yalnızca ileri tarihli ve açık ödevdir', () => {
    const tomorrow = '2026-09-27';
    expect(isDeadlineWork(task({ source: 'homework', dueDate: tomorrow }), TODAY)).toBe(true);
    // Bugün teslim: bölünecek bir şey kalmadı.
    expect(isDeadlineWork(task({ source: 'homework', dueDate: TODAY }), TODAY)).toBe(false);
    // Haftalık planın kendi görevi: gününü planlayıcı seçti.
    expect(isDeadlineWork(task({ source: 'ai_weekly_plan', dueDate: tomorrow }), TODAY)).toBe(false);
    expect(isDeadlineWork(task({ source: 'homework', dueDate: tomorrow, status: 'completed' }), TODAY)).toBe(false);
  });

  it('yaklaşan teslim ödevi listede yukarı taşır ama geciken işin önüne geçmez', () => {
    const homeworkSoon = task({ source: 'homework', dueDate: '2026-09-27' });
    const loopToday = task({ source: 'ai_weekly_plan', dueDate: TODAY });
    const lateLoop = task({ source: 'ai_weekly_plan', dueDate: '2026-09-20' });

    expect(priorityScore(homeworkSoon, TODAY, null)).toBeGreaterThan(priorityScore(loopToday, TODAY, null));
    expect(priorityScore(lateLoop, TODAY, null)).toBeGreaterThan(priorityScore(homeworkSoon, TODAY, null));
  });
});

describe('etiket tutarlılığı', () => {
  it('ödevin kart etiketi ile filtre çipi aynı şeyi söyler', () => {
    const homework = task({ type: 'problem_set', source: 'homework' });
    expect(TASK_GROUP_LABEL[taskGroupOf(homework)]).toBe('Ödev');

    const loop = task({ type: 'quiz', source: 'ai_weekly_plan' });
    expect(TASK_GROUP_LABEL[taskGroupOf(loop)]).toBe('Sınav');
  });
});
