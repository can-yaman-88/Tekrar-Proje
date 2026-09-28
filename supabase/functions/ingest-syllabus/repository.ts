import { z } from 'zod';
import type { IsoDate } from '../_shared/contracts/enums.contract.ts';
import type { Json } from '../_shared/database.types.ts';
import { HttpError } from '../_shared/errors.ts';
import type { TypedClient } from '../_shared/supabase.ts';
import type { SyllabusPayload } from './mapper.ts';

const STALE_PROCESSING_MS = 5 * 60_000;
export const SYLLABUS_BUCKET = 'syllabi';

const ApplyResultSchema = z.object({
  course_id: z.uuid(),
  topics_added: z.number().int(),
  exams_added: z.number().int(),
});

export interface ClaimedUpload {
  id: string;
  storagePath: string;
  filename: string;
}

function dbError(operation: string, cause: unknown): HttpError {
  return new HttpError('internal', `Database error during ${operation}.`, { cause });
}

export class SyllabusRepository {
  constructor(
    private readonly service: TypedClient,
    private readonly user: TypedClient,
    private readonly userId: string,
  ) {}

  /** Conditional UPDATE: only one invocation can move an upload into `processing`. */
  async claim(uploadId: string): Promise<ClaimedUpload> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();

    const { data, error } = await this.service
      .from('syllabus_uploads')
      .update({ status: 'processing', error_message: null })
      .eq('id', uploadId)
      .eq('user_id', this.userId)
      .or(`status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${staleBefore})`)
      .select('id, storage_path, original_filename')
      .maybeSingle();

    if (error) throw dbError('claim', error);
    if (data) return { id: data.id, storagePath: data.storage_path, filename: data.original_filename };

    const { data: existing, error: lookupError } = await this.user
      .from('syllabus_uploads')
      .select('status')
      .eq('id', uploadId)
      .maybeSingle();
    if (lookupError) throw dbError('claim lookup', lookupError);
    if (!existing) throw new HttpError('not_found', 'Yükleme bulunamadı.');
    throw new HttpError(
      'conflict',
      existing.status === 'succeeded' ? 'Bu izlence zaten işlendi.' : 'Bu izlence şu anda işleniyor.',
    );
  }

  async downloadPdf(storagePath: string): Promise<Uint8Array> {
    const { data, error } = await this.service.storage.from(SYLLABUS_BUCKET).download(storagePath);
    if (error || !data) throw new HttpError('not_found', 'PDF depoda bulunamadı.', { cause: error });
    return new Uint8Array(await data.arrayBuffer());
  }

  async apply(
    uploadId: string,
    model: string,
    payload: SyllabusPayload,
  ): Promise<{ courseId: string; topicsAdded: number; examsAdded: number }> {
    const { data, error } = await this.service.rpc('apply_syllabus_ingestion', {
      p_user_id: this.userId,
      p_upload_id: uploadId,
      p_llm_model: model,
      p_payload: payload satisfies Json,
    });
    if (error) throw dbError('apply syllabus', error);

    const parsed = ApplyResultSchema.safeParse(data);
    if (!parsed.success) throw dbError('apply syllabus (result)', parsed.error);
    return {
      courseId: parsed.data.course_id,
      topicsAdded: parsed.data.topics_added,
      examsAdded: parsed.data.exams_added,
    };
  }

  async markFailed(uploadId: string, message: string): Promise<void> {
    const { error } = await this.service
      .from('syllabus_uploads')
      .update({ status: 'failed', error_message: message.slice(0, 500) })
      .eq('id', uploadId)
      .eq('user_id', this.userId)
      .eq('status', 'processing');
    if (error) console.error(JSON.stringify({ event: 'mark_failed_error', uploadId, message: error.message }));
  }

  /** The upload row stores no date, so the caller's local day is passed in. */
  static today(headerDate: string | null): IsoDate {
    const date = headerDate && /^\d{4}-\d{2}-\d{2}$/.test(headerDate) ? headerDate : new Date().toISOString().slice(0, 10);
    return date;
  }
}
