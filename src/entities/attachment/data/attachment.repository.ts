import { BaseRepository } from '@shared/api/repository';
import type { Database } from '@shared/api/supabase';
import { AppError } from '@shared/lib/errors';
import {
  ATTACHMENT_BUCKET,
  storagePathFor,
  type Attachment,
  type AttachmentRelation,
  type NewAttachment,
} from '../domain/attachment';
import { readFileBytes } from './attachment-files';

type MaterialRow = Database['public']['Functions']['task_materials']['Returns'][number];

const RELATIONS: readonly AttachmentRelation[] = ['task', 'group', 'source', 'topic'];

/** The generated row type cannot say which columns a function leaves null. */
function toAttachment(row: MaterialRow): Attachment {
  const nullable = <T>(value: T | null | undefined): T | null => value ?? null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: nullable(row.url),
    bucket: nullable(row.bucket),
    storagePath: nullable(row.storage_path),
    mimeType: nullable(row.mime_type),
    sizeBytes: nullable(row.size_bytes),
    createdAt: row.created_at,
    relation: RELATIONS.includes(row.relation as AttachmentRelation) ? (row.relation as AttachmentRelation) : 'topic',
    taskId: nullable(row.task_id),
    taskTitle: nullable(row.task_title),
    editable: row.editable,
    isPending: false,
    localUri: null,
  };
}

const SIGNED_URL_SECONDS = 60 * 60;

export class AttachmentRepository extends BaseRepository {
  /** A task's own material first, then its group's, its source file and its topic's. */
  async listForTask(taskId: string): Promise<Attachment[]> {
    const rows = await this.execute('attachments.listForTask', this.db.rpc('task_materials', { p_task_id: taskId }));
    return rows.map(toAttachment);
  }

  async listForTopic(topicId: string): Promise<Attachment[]> {
    const rows = await this.execute(
      'attachments.listForTopic',
      this.db.rpc('topic_materials', { p_topic_id: topicId }),
    );
    return rows.map(toAttachment);
  }

  /**
   * Adds one attachment; safe to repeat. A replay after a dropped connection
   * finds the file already uploaded and the row already there, and stops
   * there — the id was chosen on the phone.
   */
  async add(attachment: NewAttachment): Promise<void> {
    const userId = await this.requireUserId();
    const base = {
      id: attachment.id,
      user_id: userId,
      topic_id: attachment.topicId,
      task_id: attachment.taskId,
      title: attachment.title,
    };

    if (attachment.kind === 'link') {
      await this.execute(
        'attachments.addLink',
        this.db
          .from('attachments')
          .upsert({ ...base, kind: 'link', url: attachment.url }, { onConflict: 'id', ignoreDuplicates: true }),
      );
      return;
    }

    if (!attachment.localUri || !attachment.mimeType) {
      throw new AppError('validation', 'Eklenecek dosya bulunamadı.');
    }
    const storagePath = storagePathFor(userId, attachment.id, attachment.mimeType);
    let bytes: ArrayBuffer;
    try {
      bytes = await readFileBytes(attachment.localUri);
    } catch (cause) {
      throw new AppError('validation', 'Dosya telefonda bulunamadı; yeniden eklemen gerekiyor.', { cause });
    }

    const { error: uploadError } = await this.db.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storagePath, bytes, { contentType: attachment.mimeType, upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
      throw uploadErrorOf(uploadError);
    }

    await this.execute(
      'attachments.addFile',
      this.db.from('attachments').upsert(
        {
          ...base,
          kind: 'file',
          storage_path: storagePath,
          mime_type: attachment.mimeType,
          // Storage's own measurement replaces this on the server.
          size_bytes: Math.max(1, bytes.byteLength),
        },
        { onConflict: 'id', ignoreDuplicates: true },
      ),
    );
  }

  async rename(attachmentId: string, title: string, url: string | null): Promise<void> {
    await this.execute(
      'attachments.rename',
      this.db
        .from('attachments')
        .update(url === null ? { title } : { title, url })
        .eq('id', attachmentId)
        .select('id')
        .single(),
    );
  }

  /** The row goes now; its file follows through the trash (see drainTrash). */
  async remove(attachmentId: string): Promise<void> {
    // Already gone (a replay, another device) is the outcome that was wanted.
    await this.execute('attachments.remove', this.db.from('attachments').delete().eq('id', attachmentId));
    await this.drainTrash().catch(() => undefined);
  }

  /** A short-lived address for one stored file: to show, download or hand over. */
  async signedUrl(bucket: string, path: string): Promise<string> {
    const { data, error } = await this.db.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data) {
      throw new AppError('server', 'Dosyaya ulaşılamadı.', { cause: error });
    }
    return data.signedUrl;
  }

  /** Addresses for several files of one bucket at once (thumbnails). */
  async signedUrls(bucket: string, paths: readonly string[]): Promise<Record<string, string>> {
    if (paths.length === 0) return {};
    const { data, error } = await this.db.storage.from(bucket).createSignedUrls([...paths], SIGNED_URL_SECONDS);
    if (error || !data) {
      throw new AppError('server', 'Önizlemeler yüklenemedi.', { cause: error });
    }
    const result: Record<string, string> = {};
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) result[item.path] = item.signedUrl;
    }
    return result;
  }

  /**
   * Removes from storage the files of rows already deleted — by the student,
   * or along with a topic or a course. Storage cannot be emptied from SQL, so
   * the database lists them and the app clears them.
   */
  async drainTrash(): Promise<number> {
    const rows = await this.execute(
      'storage_trash.list',
      this.db.from('storage_trash').select('id, bucket, path').order('id').limit(100),
    );
    if (rows.length === 0) return 0;

    const cleared: number[] = [];
    const byBucket = new Map<string, typeof rows>();
    for (const row of rows) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row]);
    for (const [bucket, items] of byBucket) {
      const { error } = await this.db.storage.from(bucket).remove(items.map((item) => item.path));
      // A file that is already gone is not an error here: remove reports only what it removed.
      if (!error) cleared.push(...items.map((item) => item.id));
    }
    if (cleared.length > 0) {
      await this.execute('storage_trash.clear', this.db.from('storage_trash').delete().in('id', cleared));
    }
    return cleared.length;
  }
}

function uploadErrorOf(error: { message: string }): AppError {
  if (/exceeded|maximum size|too large|payload/i.test(error.message)) {
    return new AppError('validation', 'Dosya 20 MB sınırını aşıyor.', { cause: error });
  }
  if (/row-level security|unauthorized|403/i.test(error.message)) {
    return new AppError('validation', 'Ek alanın (300 MB) dolmuş görünüyor; eski ekleri silerek yer açabilirsin.', {
      cause: error,
    });
  }
  if (/mime|content type|not supported/i.test(error.message)) {
    return new AppError('validation', 'Yalnızca PDF, JPEG, PNG ve WebP eklenebilir.', { cause: error });
  }
  if (/network|fetch|timed? ?out/i.test(error.message)) {
    return new AppError('network', 'Bağlantı yok gibi görünüyor.', { cause: error });
  }
  return new AppError('server', 'Dosya yüklenemedi.', { cause: error });
}

export const attachmentRepository = new AttachmentRepository();
