import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';

export interface FocusTimerLinkStatus {
  linkedAt: string;
  /** When the timer last reached the server; null until its first request. */
  lastUsedAt: string | null;
}

export interface IssuedLink {
  id: string;
  token: string;
}

/**
 * The pairing with the Focus Timer app. The token is issued by the database
 * and shown to nobody: it goes from here straight into the timer's intent.
 */
class FocusTimerLinkApi extends BaseRepository {
  async status(): Promise<FocusTimerLinkStatus | null> {
    const rows = await this.execute('focus_timer.status', this.db.rpc('focus_timer_link_status'));
    const row = rows[0];
    return row ? { linkedAt: row.linked_at, lastUsedAt: row.last_used_at ?? null } : null;
  }

  async issue(): Promise<IssuedLink> {
    const result = await this.execute('focus_timer.issue', this.db.rpc('issue_focus_timer_link'));
    const value = result as { id?: unknown; token?: unknown } | null;
    if (typeof value?.id !== 'string' || typeof value.token !== 'string') {
      throw new AppError('server', 'Bağlantı anahtarı oluşturulamadı.');
    }
    return { id: value.id, token: value.token };
  }

  /** With an id, withdraws that one pairing; without, disconnects the timer. */
  async revoke(linkId?: string): Promise<void> {
    await this.execute(
      'focus_timer.revoke',
      this.db.rpc('revoke_focus_timer_link', linkId ? { p_link_id: linkId } : {}),
    );
  }
}

export const focusTimerLinkApi = new FocusTimerLinkApi();
