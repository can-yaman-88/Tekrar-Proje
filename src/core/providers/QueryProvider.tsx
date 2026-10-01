import { QUERY_CACHE_BUSTER, QUERY_CACHE_MAX_AGE_MS, queryClient, queryPersister } from '@shared/api/query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ReactNode } from 'react';
import { sweepAttachmentOutbox } from '../bootstrap/attachmentHousekeeping';

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: QUERY_CACHE_MAX_AGE_MS,
        buster: QUERY_CACHE_BUSTER,
        // Queries marked `persist: false` (signed URLs that expire) stay in memory only.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === 'success' && query.meta?.persist !== false,
        },
      }}
      // Paused offline mutations resume once the cache is restored.
      onSuccess={() => {
        sweepAttachmentOutbox();
        return queryClient.resumePausedMutations();
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
