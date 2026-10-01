import type { AppError as AppErrorType } from '../../../lib/errors';
import type * as Telemetry from '../reportError';

const mockRpc = jest.fn();
const mockGetSession = jest.fn();
const mockStore = new Map<string, string>();

jest.mock('../../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getSession: () => mockGetSession() },
  },
}));

jest.mock('../../../lib/storage', () => ({
  appStorage: {
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => void mockStore.set(key, value),
    remove: (key: string) => void mockStore.delete(key),
  },
}));

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('reportError', () => {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
  let telemetry: typeof Telemetry;
  let AppError: typeof AppErrorType;

  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    jest.resetModules();
    mockRpc.mockReset().mockResolvedValue({ data: true, error: null });
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockStore.clear();
    // A fresh module per test: the dedupe window and the per-run cap start over.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    telemetry = require('../reportError');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ AppError } = require('../../../lib/errors'));
  });

  afterAll(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  });

  it('files server and unknown errors with where they happened', async () => {
    telemetry.reportError(new AppError('server', 'boom', { cause: { operation: 'tasks.list', code: 'XX000' } }), {
      source: 'query',
      where: '["tasks"]',
    });
    await flush();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('report_app_error');
    expect(args.p_kind).toBe('server');
    expect(args.p_message).toBe('boom');
    expect(args.p_detail).toMatchObject({ source: 'query', where: '["tasks"]', operation: 'tasks.list', code: 'XX000' });
  });

  it('leaves expected failures alone', async () => {
    for (const kind of ['network', 'validation', 'unauthorized', 'not_found', 'conflict', 'rate_limited'] as const) {
      telemetry.reportError(new AppError(kind, kind), { source: 'mutation' });
    }
    await flush();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sends the same error once per window', async () => {
    telemetry.reportError(new Error('same'), { source: 'global' });
    telemetry.reportError(new Error('same'), { source: 'global' });
    telemetry.reportError(new Error('other'), { source: 'global' });
    await flush();
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('stops after a run has said enough', async () => {
    for (let i = 0; i < 50; i++) telemetry.reportError(new Error(`error ${i}`), { source: 'global' });
    await flush();
    expect(mockRpc).toHaveBeenCalledTimes(20);
  });

  it('does nothing without a session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    telemetry.reportError(new Error('signed out'), { source: 'global' });
    await flush();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('keeps a crash for the next start and forgets it once sent', async () => {
    telemetry.rememberCrash(new Error('fatal'), { source: 'global', where: 'fatal' });
    expect(mockStore.size).toBe(1);

    mockGetSession.mockResolvedValue({ data: { session: null } });
    telemetry.flushPendingCrash();
    await flush();
    expect(mockStore.size).toBe(1);

    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    telemetry.flushPendingCrash();
    await flush();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_message).toBe('fatal');
    expect(args.p_detail).toMatchObject({ previousRun: true, where: 'fatal' });
    expect(mockStore.size).toBe(0);
  });

  it('stays quiet in development builds', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    telemetry.reportError(new Error('dev'), { source: 'global' });
    await flush();
    expect(mockRpc).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
