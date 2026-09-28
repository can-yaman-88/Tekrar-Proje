import { createMMKV, type MMKV } from 'react-native-mmkv';

/** Separate instances so sign-out can wipe caches without touching app preferences. */
export const authStorage = createMMKV({ id: 'tekrar.auth' });
export const queryCacheStorage = createMMKV({ id: 'tekrar.query-cache' });
export const appStorage = createMMKV({ id: 'tekrar.app' });

/** The `getItem/setItem/removeItem` shape expected by supabase-js, Zustand and React Query. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function asKeyValueStorage(mmkv: MMKV): KeyValueStorage {
  return {
    getItem: (key) => mmkv.getString(key) ?? null,
    setItem: (key, value) => mmkv.set(key, value),
    removeItem: (key) => {
      mmkv.remove(key);
    },
  };
}
