import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import { AppError, fromPostgrestError, toAppError } from '../../lib/errors';
import { supabase, type TypedSupabaseClient } from '../supabase';

/**
 * Base class for the data layer. Subclasses build typed PostgREST queries;
 * this class turns every outcome into either typed data or an AppError, so
 * hooks and UI never see Supabase-specific error shapes.
 */
export abstract class BaseRepository {
  constructor(protected readonly db: TypedSupabaseClient = supabase) {}

  protected async execute<T>(operation: string, query: PromiseLike<PostgrestSingleResponse<T>>): Promise<T> {
    let result: PostgrestSingleResponse<T>;
    try {
      result = await query;
    } catch (cause) {
      throw toAppError(cause);
    }
    if (result.error) throw fromPostgrestError(result.error, operation);
    return result.data;
  }

  /** Reads the user id from the locally persisted session (no network round-trip). */
  protected async requireUserId(): Promise<string> {
    const { data, error } = await this.db.auth.getSession();
    const userId = data.session?.user.id;
    if (error || !userId) throw new AppError('unauthorized', 'Giriş yapman gerekiyor.', { cause: error });
    return userId;
  }
}
