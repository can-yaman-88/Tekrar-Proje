import { parseCapacityOverrides } from '@domain/capacity';
import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';
import type { Profile } from '../domain/profile';

const PROFILE_SELECT =
  'id, display_name, timezone, llm_model, llm_key_hint, llm_key_set_at, auto_weekly_plan, blocked_weekdays, capacity_overrides';

export class ProfileRepository extends BaseRepository {
  async get(): Promise<Profile> {
    const userId = await this.requireUserId();
    const row = await this.execute(
      'profiles.get',
      this.db.from('profiles').select(PROFILE_SELECT).eq('id', userId).single(),
    );
    return {
      id: row.id,
      displayName: row.display_name,
      timezone: row.timezone,
      llmModel: row.llm_model,
      llmKeyHint: row.llm_key_hint,
      llmKeySetAt: row.llm_key_set_at,
      autoWeeklyPlan: row.auto_weekly_plan,
      blockedWeekdays: [...row.blocked_weekdays].sort((a, b) => a - b),
      capacityOverrides: parseCapacityOverrides(row.capacity_overrides),
    };
  }

  /**
   * The student's own minutes per weekday. Only sane values are sent; the
   * database checks them again (15–600, weekdays 1–7).
   */
  async setCapacityOverrides(overrides: Readonly<Record<number, number>>): Promise<void> {
    const userId = await this.requireUserId();
    const clean: Record<string, number> = {};
    for (const [weekday, minutes] of Object.entries(parseCapacityOverrides(overrides))) clean[weekday] = minutes;
    await this.execute(
      'profiles.setCapacityOverrides',
      this.db.from('profiles').update({ capacity_overrides: clean }).eq('id', userId).select('id').single(),
    );
  }

  /**
   * The device's IANA timezone, so the server can tell which day a timestamp
   * belongs to. The database refuses names it does not know.
   */
  async setTimezone(timezone: string): Promise<void> {
    const userId = await this.requireUserId();
    await this.execute(
      'profiles.setTimezone',
      this.db.from('profiles').update({ timezone }).eq('id', userId).select('id').single(),
    );
  }

  /**
   * The days the student is never available.
   *
   * The database refuses a full week, and so does the app before it gets
   * there: a plan with nowhere to go is not a plan.
   */
  async setBlockedWeekdays(weekdays: readonly number[]): Promise<void> {
    const userId = await this.requireUserId();
    const unique = [...new Set(weekdays)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
    if (unique.length > 6) throw new AppError('validation', 'Haftanın tamamını kapatamazsın.');
    await this.execute(
      'profiles.setBlockedWeekdays',
      this.db.from('profiles').update({ blocked_weekdays: unique }).eq('id', userId).select('id').single(),
    );
  }

  async setAutoWeeklyPlan(enabled: boolean): Promise<void> {
    const userId = await this.requireUserId();
    await this.execute(
      'profiles.setAutoWeeklyPlan',
      this.db.from('profiles').update({ auto_weekly_plan: enabled }).eq('id', userId).select('id').single(),
    );
  }

  /**
   * Hands the key to the database, which puts it in Vault. It is deliberately
   * a one-way trip: nothing in the app can read it back, including this class.
   */
  async setLlmApiKey(apiKey: string): Promise<string> {
    const result = await this.execute('profiles.setLlmApiKey', this.db.rpc('set_llm_api_key', { p_key: apiKey }));
    const payload = result as { hint?: string } | null;
    return payload?.hint ?? '';
  }

  async clearLlmApiKey(): Promise<void> {
    await this.execute('profiles.clearLlmApiKey', this.db.rpc('clear_llm_api_key'));
  }

  /** `null` restores the project default. */
  async setLlmModel(llmModel: string | null): Promise<void> {
    const userId = await this.requireUserId();
    await this.execute(
      'profiles.setLlmModel',
      this.db.from('profiles').update({ llm_model: llmModel }).eq('id', userId).select('id').single(),
    );
  }
}

export const profileRepository = new ProfileRepository();
