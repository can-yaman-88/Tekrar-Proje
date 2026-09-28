import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { clearSecureData, secureDataStorage } from '../../lib/storage';

/** Bump when a cached query's data shape changes, to discard old caches on upgrade. */
export const QUERY_CACHE_BUSTER = 'v2';
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The cache mirrors the user's data, so it is written to an encrypted store. */
export const queryPersister = createAsyncStoragePersister({
  storage: secureDataStorage,
  key: 'tekrar.rq',
  throttleTime: 1_000,
});

export function clearPersistedQueryCache(): void {
  void clearSecureData();
}
