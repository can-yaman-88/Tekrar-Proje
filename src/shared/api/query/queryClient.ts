import { QueryCache, QueryClient } from '@tanstack/react-query';
import { toAppError } from '../../lib/errors';
import { QUERY_CACHE_MAX_AGE_MS } from './persister';

const MAX_RETRIES = 3;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const appError = toAppError(error);
      if (__DEV__ && appError.kind !== 'network') {
        console.warn(`[query] ${JSON.stringify(query.queryKey)} failed: ${appError.kind} — ${appError.message}`);
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: QUERY_CACHE_MAX_AGE_MS, // must be >= persister maxAge or cache is dropped before persisting
      networkMode: 'offlineFirst', // serve persisted data immediately when offline
      retry: (failureCount, error) => toAppError(error).retryable && failureCount < MAX_RETRIES,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 15_000),
    },
    mutations: {
      // Offline mutations are paused (not failed) and resumed on reconnect;
      // this retry only covers transient server hiccups.
      retry: (failureCount, error) => toAppError(error).kind === 'server' && failureCount < 2,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000),
    },
  },
});
