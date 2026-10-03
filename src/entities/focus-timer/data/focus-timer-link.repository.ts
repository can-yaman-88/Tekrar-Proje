import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';

/** One device the Focus Timer is paired on. */
export interface FocusTimerDevice {
  id: string;
  /** The device's own name, as its timer reported it; null until a timer that sends one reports. */
  label: string | null;
  linkedAt: string;
  /** When the timer last reached the server; null until its first request. */
  lastUsedAt: string | null;
}

export interface IssuedLink {
  id: string;
  token: string;
}

/** Eight characters to type into the timer on another device. */
export interface PairingCode {
  code: string;
  expiresAt: string;
}

/**
 * The pairings with the Focus Timer app, one per device. A token is issued by
 * the database and shown to nobody: it goes from here straight into the
 * timer's intent. A pairing code is the way in for a device without Tekrar.
 */
class FocusTimerLinkRepository extends BaseRepository {
  async devices(): Promise<FocusTimerDevice[]> {
    const rows = await this.execute('focus_timer.devices', this.db.rpc('focus_timer_devices'));
    return rows.map((row) => ({
      id: row.id,
      label: row.label ?? null,
      linkedAt: row.linked_at,
      lastUsedAt: row.last_used_at ?? null,
    }));
  }

  async issue(): Promise<IssuedLink> {
    const result = await this.execute('focus_timer.issue', this.db.rpc('issue_focus_timer_link'));
    const value = result as { id?: unknown; token?: unknown } | null;
    if (typeof value?.id !== 'string' || typeof value.token !== 'string') {
      throw new AppError('server', 'Bağlantı anahtarı oluşturulamadı.');
    }
    return { id: value.id, token: value.token };
  }

  async issueCode(): Promise<PairingCode> {
    const result = await this.execute('focus_timer.issue_code', this.db.rpc('issue_focus_timer_code'));
    const value = result as { code?: unknown; expiresAt?: unknown } | null;
    if (typeof value?.code !== 'string' || typeof value.expiresAt !== 'string') {
      throw new AppError('server', 'Bağlantı kodu oluşturulamadı.');
    }
    return { code: value.code, expiresAt: value.expiresAt };
  }

  /** With an id, removes that one device's pairing; without, disconnects every device. */
  async revoke(linkId?: string): Promise<void> {
    await this.execute(
      'focus_timer.revoke',
      this.db.rpc('revoke_focus_timer_link', linkId ? { p_link_id: linkId } : {}),
    );
  }
}

export const focusTimerLinkRepository = new FocusTimerLinkRepository();
