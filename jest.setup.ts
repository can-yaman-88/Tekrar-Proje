// Native modules do not exist under Jest; these stand-ins let pure domain code
// be imported through the same entry points the app uses.

process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

jest.mock('react-native-mmkv', () => {
  class MemoryMMKV {
    private readonly store = new Map<string, string>();
    getString(key: string) {
      return this.store.get(key);
    }
    set(key: string, value: string) {
      this.store.set(key, String(value));
    }
    remove(key: string) {
      return this.store.delete(key);
    }
    clearAll() {
      this.store.clear();
    }
    getAllKeys() {
      return [...this.store.keys()];
    }
  }
  return { createMMKV: () => new MemoryMMKV() };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock',
}));

jest.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
}));

// Icon fonts are native assets; components under test only need a placeholder.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
