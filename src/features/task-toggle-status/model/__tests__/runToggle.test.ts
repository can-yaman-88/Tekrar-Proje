import type { Task } from '@entities/task';

const mockUpdateStatus = jest.fn(async () => ({}) as Task);

jest.mock('@entities/task', () => ({
  ...jest.requireActual('@entities/task/domain/task.rules'),
  taskRepository: { updateStatus: (...args: unknown[]) => mockUpdateStatus(...(args as [])) },
  taskKeys: { all: ['tasks'], mission: () => ['tasks', 'mission'] },
  taskMutationKeys: { toggle: ['tasks', 'toggle'] },
}));
jest.mock('@entities/topic', () => ({ reviewKeys: { all: ['topic-reviews'] }, topicKeys: { all: ['topics'] } }));

// eslint-disable-next-line import/first
import { runToggle, statusForRating } from '../useToggleTaskStatus';

const task = { id: 't1', status: 'pending', completedCount: 0 } as Task;

describe('görev durumu değişikliği', () => {
  beforeEach(() => mockUpdateStatus.mockClear());

  it('1 puan konunun geri dönmediğini söyler: iş başarısız sayılır', () => {
    expect(statusForRating(1)).toBe('failed');
    expect(statusForRating(2)).toBe('completed');
    expect(statusForRating(5)).toBe('completed');
  });

  it('kuyruktaki yeni biçim gün ve puanı taşır', async () => {
    await runToggle({ task, status: 'completed', on: '2026-09-30', confidence: 4 });
    expect(mockUpdateStatus).toHaveBeenCalledWith('t1', 'completed', { on: '2026-09-30', confidence: 4 });
  });

  it('eski sürümün kuyruğa yazdığı çıplak görev hâlâ "çevir" demektir', async () => {
    await runToggle(task);
    expect(mockUpdateStatus).toHaveBeenCalledWith('t1', 'completed');
  });
});
