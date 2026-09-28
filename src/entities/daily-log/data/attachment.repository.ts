import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';
import type { CheckinAttachment, NewAttachment } from '../domain/daily-log';

export const ATTACHMENT_BUCKET = 'checkin-attachments';
const SELECT = 'id, original_filename, mime_type, size_bytes';

export class AttachmentRepository extends BaseRepository {
  /** Uploads to the user's private folder, then records the row. */
  async add(dailyLogId: string, file: NewAttachment): Promise<CheckinAttachment> {
    const userId = await this.requireUserId();
    const storagePath = `${userId}/${file.objectName}`;

    const { error: uploadError } = await this.db.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storagePath, file.bytes, { contentType: file.mimeType, upsert: false });
    if (uploadError) {
      throw /exceeded|maximum size|too large/i.test(uploadError.message)
        ? new AppError('validation', 'Dosya 10 MB sınırını aşıyor.', { cause: uploadError })
        : new AppError('server', 'Dosya yüklenemedi.', { cause: uploadError });
    }

    const row = await this.execute(
      'daily_log_attachments.add',
      this.db
        .from('daily_log_attachments')
        .insert({
          user_id: userId,
          daily_log_id: dailyLogId,
          storage_path: storagePath,
          original_filename: file.filename,
          mime_type: file.mimeType,
          size_bytes: file.sizeBytes,
        })
        .select(SELECT)
        .single(),
    );

    return {
      id: row.id,
      filename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
    };
  }
}

export const attachmentRepository = new AttachmentRepository();
