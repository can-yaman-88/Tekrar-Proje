import type { IsoDate } from '@contracts/enums.contract';
import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';
import { z } from 'zod';
import type { ErrorDigest, ErrorGroupDetail, StoredDigest } from '../domain/error-digest';

// The digest is built in SQL and arrives as JSON: checked here, so a shape the
// screen does not expect is a clear error rather than a blank row.
const GroupSchema = z.object({
  fingerprint: z.string(),
  source: z.enum(['app', 'edge']),
  kind: z.string(),
  location: z.string().nullable(),
  message: z.string(),
  count: z.number(),
  users: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  appVersion: z.string().nullable(),
  isNew: z.boolean(),
  isRegression: z.boolean(),
  resolvedAt: z.string().nullable(),
});

const DigestSchema = z.object({
  from: z.string(),
  to: z.string(),
  total: z.number(),
  previousTotal: z.number(),
  groups: z.number(),
  affectedUsers: z.number(),
  newGroups: z.number(),
  regressions: z.number(),
  bySource: z.object({ app: z.number(), edge: z.number() }),
  versions: z.array(z.object({ version: z.string().nullable(), platform: z.string().nullable(), count: z.number() })),
  top: z.array(GroupSchema),
});

const GroupDetailSchema = z.object({
  reports: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      message: z.string(),
      detail: z.record(z.string(), z.unknown()).nullable(),
      appVersion: z.string().nullable(),
      platform: z.string().nullable(),
      reporter: z.string().nullable(),
    }),
  ),
  resolvedAt: z.string().nullable(),
  note: z.string().nullable(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('unknown', 'Hata özeti beklenmeyen biçimde geldi.', { cause: { operation, issues: result.error.issues } });
  }
  return result.data;
}

export class ErrorReportRepository extends BaseRepository {
  /** Whether the signed-in account may read the digest — its own row, or none. */
  async isAdmin(): Promise<boolean> {
    const userId = await this.requireUserId();
    const row = await this.execute(
      'app_admins.self',
      this.db.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    );
    return row !== null;
  }

  /** The last `days` days, built now. */
  async liveDigest(days: number): Promise<ErrorDigest> {
    const data = await this.execute('error_digest.live', this.db.rpc('admin_error_digest', { p_days: days }));
    return parse(DigestSchema, data, 'error_digest.live');
  }

  /** The Monday digests, newest first. */
  async storedDigests(limit = 12): Promise<StoredDigest[]> {
    const rows = await this.execute(
      'error_digest.stored',
      this.db
        .from('error_digests')
        .select('week_start, payload, notified_at')
        .order('week_start', { ascending: false })
        .limit(limit),
    );
    return rows.map((row) => ({
      weekStart: row.week_start as IsoDate,
      digest: parse(DigestSchema, row.payload, 'error_digest.stored'),
      notifiedAt: row.notified_at,
    }));
  }

  async groupDetail(fingerprint: string): Promise<ErrorGroupDetail> {
    const data = await this.execute(
      'error_digest.group',
      this.db.rpc('admin_error_group_reports', { p_fingerprint: fingerprint, p_limit: 20 }),
    );
    return parse(GroupDetailSchema, data, 'error_digest.group');
  }

  async setResolved(fingerprint: string, resolved: boolean): Promise<void> {
    await this.execute(
      'error_digest.resolve',
      this.db.rpc('admin_set_error_group_resolved', { p_fingerprint: fingerprint, p_resolved: resolved }),
    );
  }
}

export const errorReportRepository = new ErrorReportRepository();
