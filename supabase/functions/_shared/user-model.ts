import type { TypedClient } from './supabase.ts';

/** The model choice and the key that pays for it, read together. */
export interface UserLlmSettings {
  model: string | null;
  apiKey: string | null;
}

/**
 * The model id the student picked in Settings. Never fatal: a failed read just
 * means the project default is used.
 */
export async function readUserModel(client: TypedClient, userId: string): Promise<string | null> {
  const { data, error } = await client.from('profiles').select('llm_model').eq('id', userId).maybeSingle();
  if (error) {
    console.warn(JSON.stringify({ event: 'user_model_read_failed', userId, message: error.message }));
    return null;
  }
  return data?.llm_model ?? null;
}

/**
 * The student's own provider key, out of Vault.
 *
 * Only a service-role client can call this RPC; the key exists in the app's
 * reach for exactly as long as one HTTP request. A missing or failed read is
 * not fatal — the deployment's own key takes over.
 */
export async function readUserApiKey(client: TypedClient, userId: string): Promise<string | null> {
  const { data, error } = await client.rpc('read_llm_api_key', { p_user_id: userId });
  if (error) {
    console.warn(JSON.stringify({ event: 'user_key_read_failed', userId, message: error.message }));
    return null;
  }
  return typeof data === 'string' && data.length > 0 ? data : null;
}

/** Both settings in one round trip, for the flows that need them together. */
export async function readUserLlmSettings(client: TypedClient, userId: string): Promise<UserLlmSettings> {
  const [model, apiKey] = await Promise.all([readUserModel(client, userId), readUserApiKey(client, userId)]);
  return { model, apiKey };
}
