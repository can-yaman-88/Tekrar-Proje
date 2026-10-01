import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { toAppError } from '../../lib/errors';
import { appStorage } from '../../lib/storage';
import { supabase, type Json } from '../supabase';

/** Where in the app an error surfaced. */
export type ErrorSource = 'query' | 'mutation' | 'render' | 'global';

export interface ErrorContext {
  source: ErrorSource;
  /** The query or mutation key, or the screen — whatever narrows it down. */
  where?: string;
}

/** At most this many reports leave one app run, whatever happens. */
const MAX_PER_RUN = 20;
/** The same error again within this window is the same error. */
const DEDUPE_MS = 10 * 60 * 1000;
/** A crash kills the app before a request can finish; it waits here for the next start. */
const PENDING_CRASH_KEY = 'telemetry.pending-crash';

const lastSent = new Map<string, number>();
let sentThisRun = 0;

interface Report {
  kind: string;
  message: string;
  detail: Record<string, unknown>;
}

const appVersion = (): string | null => Constants.expoConfig?.version ?? null;

function describe(error: unknown, context: ErrorContext): Report | null {
  const appError = toAppError(error);
  // Only what the student cannot fix: no connection, a wrong form, an expired
  // session are expected, and the app already says so.
  if (appError.kind !== 'server' && appError.kind !== 'unknown') return null;
  const original = error instanceof Error ? error : null;
  const cause = (appError.cause ?? {}) as { operation?: unknown; code?: unknown };
  return {
    kind: appError.kind,
    message: (original?.message ?? appError.message).slice(0, 500),
    detail: {
      source: context.source,
      where: context.where ?? null,
      name: original?.name ?? null,
      operation: typeof cause.operation === 'string' ? cause.operation : null,
      code: typeof cause.code === 'string' ? cause.code : null,
      requestId: appError.requestId ?? null,
      stack: original?.stack?.split('\n').slice(0, 12).join('\n') ?? null,
    },
  };
}

/** Resolves true once the server has it. */
async function send(report: Report): Promise<boolean> {
  // Reports belong to an account; signed out there is no one to file them under.
  const { data } = await supabase.auth.getSession();
  if (!data.session) return false;
  const { error } = await supabase.rpc('report_app_error', {
    p_kind: report.kind,
    p_message: report.message,
    p_detail: report.detail as Json,
    p_app_version: appVersion() ?? undefined,
    p_platform: Platform.OS,
  });
  return error === null;
}

/**
 * Files an unexpected error with the server, so a failure one student hits is
 * seen without waiting for them to describe it. Best effort and quiet: it
 * never throws, never repeats itself, and stays out of development builds.
 */
export function reportError(error: unknown, context: ErrorContext): void {
  try {
    const report = describe(error, context);
    if (report === null) return;
    if (__DEV__) {
      console.warn(`[report] ${context.source}${context.where ? ` ${context.where}` : ''}: ${report.message}`);
      return;
    }
    const fingerprint = `${report.kind}|${context.where ?? ''}|${report.message.slice(0, 120)}`;
    const now = Date.now();
    if (sentThisRun >= MAX_PER_RUN || now - (lastSent.get(fingerprint) ?? 0) < DEDUPE_MS) return;
    lastSent.set(fingerprint, now);
    sentThisRun++;
    void send(report).catch(() => undefined);
  } catch {
    // Reporting must never be the second error.
  }
}

/** For a crash: kept on the device synchronously, sent on the next start. */
export function rememberCrash(error: unknown, context: ErrorContext): void {
  try {
    const report = describe(error, context);
    if (report === null || __DEV__) return;
    appStorage.set(PENDING_CRASH_KEY, JSON.stringify(report));
  } catch {
    // Nothing left to do while the app is going down.
  }
}

/** Sends the crash the previous run could not; call once signed in. */
export function flushPendingCrash(): void {
  try {
    const raw = appStorage.getString(PENDING_CRASH_KEY);
    if (!raw) return;
    const report = JSON.parse(raw) as Report;
    void send({ ...report, detail: { ...report.detail, previousRun: true } })
      .then((sent) => {
        if (sent) appStorage.remove(PENDING_CRASH_KEY);
      })
      .catch(() => undefined);
  } catch {
    appStorage.remove(PENDING_CRASH_KEY);
  }
}
