import {
  acceptedMime,
  attachmentRepository,
  downloadToCache,
  isImage,
  localCopyOf,
  type Attachment,
  type AttachmentMime,
} from '@entities/attachment';
import { AppError } from '@shared/lib/errors';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Linking, Platform, Share } from 'react-native';

export type OpenOutcome = { kind: 'opened' } | { kind: 'image'; uri: string };

// Lets the viewer app read the one file it is handed (FLAG_GRANT_READ_URI_PERMISSION).
const GRANT_READ = 1;

const UTI: Record<AttachmentMime, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'image/webp': 'org.webmproject.webp',
};

function mimeOf(attachment: Attachment): AttachmentMime {
  const mime = acceptedMime(attachment.mimeType);
  if (!mime) throw new AppError('validation', 'Bu dosya türü açılamıyor.');
  return mime;
}

/**
 * The file on this phone: the copy made when it was added or last opened,
 * else downloaded now and kept for next time — the second open needs no
 * connection.
 */
async function localFileOf(attachment: Attachment, mime: AttachmentMime) {
  const local = localCopyOf(attachment.id, mime, attachment.localUri);
  if (local) return local;
  if (!attachment.bucket || !attachment.storagePath) {
    throw new AppError('validation', 'Dosya henüz gönderilmedi ve bu telefonda da yok.');
  }
  const url = await attachmentRepository.signedUrl(attachment.bucket, attachment.storagePath);
  return downloadToCache(url, attachment.id, mime);
}

async function shareFile(uri: string, mime: AttachmentMime, title: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new AppError('validation', 'Bu cihazda dosya paylaşılamıyor.');
  }
  await Sharing.shareAsync(uri, { mimeType: mime, UTI: UTI[mime], dialogTitle: title });
}

/**
 * Opens an attachment where it reads best: a link in the browser (or the
 * YouTube app), a PDF in the phone's PDF viewer, a picture in the app's own
 * viewer — the caller shows that one.
 */
export async function openAttachment(attachment: Attachment): Promise<OpenOutcome> {
  if (attachment.kind === 'link') {
    if (!attachment.url) throw new AppError('validation', 'Bu linkin adresi yok.');
    await Linking.openURL(attachment.url);
    return { kind: 'opened' };
  }

  const mime = mimeOf(attachment);
  const file = await localFileOf(attachment, mime);
  if (isImage(attachment)) return { kind: 'image', uri: file.uri };

  if (Platform.OS === 'android') {
    // Resolves only when the viewer is closed; a phone with no PDF viewer
    // fails at once and gets the "open with" sheet instead.
    void IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      type: mime,
      flags: GRANT_READ,
    }).catch(() => shareFile(file.uri, mime, attachment.title).catch(() => undefined));
    return { kind: 'opened' };
  }
  await shareFile(file.uri, mime, attachment.title);
  return { kind: 'opened' };
}

/** A picture in the phone's own viewer, which can zoom (Android). */
export async function viewInOtherApp(attachment: Attachment): Promise<void> {
  const mime = mimeOf(attachment);
  const file = await localFileOf(attachment, mime);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: mime,
    flags: GRANT_READ,
  });
}

/** Hands an attachment to another app: WhatsApp to a friend, Drive, a printer. */
export async function shareAttachment(attachment: Attachment): Promise<void> {
  if (attachment.kind === 'link') {
    await Share.share({ message: attachment.url ?? '', title: attachment.title });
    return;
  }
  const mime = mimeOf(attachment);
  const file = await localFileOf(attachment, mime);
  await shareFile(file.uri, mime, attachment.title);
}
