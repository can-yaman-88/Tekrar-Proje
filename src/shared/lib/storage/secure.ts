import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import { authStorage as legacyAuthStorage } from './mmkv';

/**
 * Session tokens and the cached copy of the student's data are encrypted at
 * rest. MMKV needs the key synchronously, but the key itself lives in the
 * platform keystore (Keychain / Android Keystore) and is read asynchronously,
 * so every consumer goes through the async adapters below.
 */
const KEYSTORE_ENTRY = 'tekrar.mmkv.key';
const AUTH_ID = 'tekrar.secure.auth';
const DATA_ID = 'tekrar.secure.data';

export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

async function readOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEYSTORE_ENTRY);
  if (existing) return existing;

  // 32 random bytes as hex; generated on device, never leaves the keystore.
  const key = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEYSTORE_ENTRY, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key;
}

interface SecureStorages {
  auth: MMKV;
  data: MMKV;
}

let storagesPromise: Promise<SecureStorages> | null = null;

/** One-time move of tokens written before encryption existed. */
function migrateLegacyAuth(auth: MMKV): void {
  try {
    const keys = legacyAuthStorage.getAllKeys();
    if (keys.length === 0) return;
    for (const key of keys) {
      const value = legacyAuthStorage.getString(key);
      if (value !== undefined) auth.set(key, value);
    }
    legacyAuthStorage.clearAll();
  } catch {
    // A failed migration only costs the user a new sign-in.
  }
}

function getStorages(): Promise<SecureStorages> {
  storagesPromise ??= readOrCreateKey().then((encryptionKey) => {
    const auth = createMMKV({ id: AUTH_ID, encryptionKey });
    const data = createMMKV({ id: DATA_ID, encryptionKey });
    migrateLegacyAuth(auth);
    return { auth, data };
  });
  return storagesPromise;
}

function adapter(pick: (storages: SecureStorages) => MMKV): AsyncKeyValueStorage {
  return {
    getItem: async (key) => pick(await getStorages()).getString(key) ?? null,
    setItem: async (key, value) => {
      pick(await getStorages()).set(key, value);
    },
    removeItem: async (key) => {
      pick(await getStorages()).remove(key);
    },
  };
}

/** Supabase auth tokens. */
export const secureAuthStorage = adapter((s) => s.auth);

/** The persisted React Query cache — a full copy of the user's courses and tasks. */
export const secureDataStorage = adapter((s) => s.data);

export async function clearSecureData(): Promise<void> {
  (await getStorages()).data.clearAll();
}
