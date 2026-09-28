import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';
import type { SyllabusUpload } from '../domain/syllabus-upload';

const UPLOAD_SELECT = 'id, original_filename, status, error_message, course_id, created_at, storage_path';
export const SYLLABUS_BUCKET = 'syllabi';

export class SyllabusUploadRepository extends BaseRepository {
  async listRecent(limit = 10): Promise<SyllabusUpload[]> {
    const rows = await this.execute(
      'syllabus_uploads.listRecent',
      this.db
        .from('syllabus_uploads')
        .select(UPLOAD_SELECT)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return rows.map((row) => ({
      id: row.id,
      filename: row.original_filename,
      status: row.status,
      errorMessage: row.error_message,
      courseId: row.course_id,
      createdAt: row.created_at,
      storagePath: row.storage_path,
    }));
  }

  /** Removes the record and the PDF behind it. */
  async remove(upload: Pick<SyllabusUpload, 'id' | 'storagePath'>): Promise<void> {
    await this.execute(
      'syllabus_uploads.remove',
      this.db.from('syllabus_uploads').delete().eq('id', upload.id).select('id').single(),
    );
    // Best effort: an orphaned file is harmless, a failed delete should not be.
    const { error } = await this.db.storage.from(SYLLABUS_BUCKET).remove([upload.storagePath]);
    if (error) console.warn(`[storage] ${upload.storagePath} silinemedi: ${error.message}`);
  }

  /** Uploads the PDF to the user's private folder, then records it. */
  async upload(input: { filename: string; bytes: ArrayBuffer; objectName: string }): Promise<string> {
    const userId = await this.requireUserId();
    const storagePath = `${userId}/${input.objectName}`;

    const { error: uploadError } = await this.db.storage
      .from(SYLLABUS_BUCKET)
      .upload(storagePath, input.bytes, { contentType: 'application/pdf', upsert: false });
    if (uploadError) throw this.storageError(uploadError);

    const row = await this.execute(
      'syllabus_uploads.create',
      this.db
        .from('syllabus_uploads')
        .insert({ user_id: userId, storage_path: storagePath, original_filename: input.filename })
        .select('id')
        .single(),
    );
    return row.id;
  }

  private storageError(error: { message: string }) {
    return /exceeded|maximum size|too large/i.test(error.message)
      ? new AppError('validation', 'Dosya 20 MB sınırını aşıyor.', { cause: error })
      : new AppError('server', 'PDF yüklenemedi.', { cause: error });
  }
}

export const syllabusUploadRepository = new SyllabusUploadRepository();
