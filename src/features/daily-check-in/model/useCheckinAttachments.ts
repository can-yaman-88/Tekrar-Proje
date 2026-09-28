import type { AttachmentMime } from '@contracts/enums.contract';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME: Record<string, AttachmentMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** A file chosen on the device; uploaded only when the check-in is submitted. */
export interface PickedAttachment {
  uri: string;
  filename: string;
  mimeType: AttachmentMime;
  sizeBytes: number;
}

function imageMimeOf(asset: ImagePicker.ImagePickerAsset): AttachmentMime {
  if (asset.mimeType && asset.mimeType in IMAGE_MIME) return IMAGE_MIME[asset.mimeType] ?? 'image/jpeg';
  const direct: AttachmentMime[] = ['image/jpeg', 'image/png', 'image/webp'];
  const matched = direct.find((mime) => mime === asset.mimeType);
  if (matched) return matched;
  const extension = asset.uri.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME[extension] ?? 'image/jpeg';
}

export function useCheckinAttachments() {
  const [files, setFiles] = useState<PickedAttachment[]>([]);

  const append = useCallback((file: PickedAttachment): boolean => {
    if (file.sizeBytes > MAX_BYTES) {
      showToast('Dosya 10 MB sınırını aşıyor.', 'danger');
      return false;
    }
    let added = false;
    setFiles((current) => {
      if (current.length >= MAX_FILES) {
        showToast(`En fazla ${MAX_FILES} dosya ekleyebilirsin.`, 'info');
        return current;
      }
      added = true;
      return [...current, file];
    });
    return added;
  }, []);

  const pickPdf = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;
      append({
        uri: asset.uri,
        filename: asset.name,
        mimeType: 'application/pdf',
        sizeBytes: asset.size ?? 0,
      });
    } catch (error) {
      showToast(describeError(error).message, 'danger');
    }
  }, [append]);

  const pickImage = useCallback(
    async (source: 'library' | 'camera') => {
      try {
        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            showToast('Kamera izni verilmedi.', 'danger');
            return;
          }
        }
        const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
        const picked =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
        if (picked.canceled) return;
        const asset = picked.assets[0];
        if (!asset) return;
        append({
          uri: asset.uri,
          filename: asset.fileName ?? `foto-${Crypto.randomUUID().slice(0, 8)}.jpg`,
          mimeType: imageMimeOf(asset),
          sizeBytes: asset.fileSize ?? 0,
        });
      } catch (error) {
        showToast(describeError(error).message, 'danger');
      }
    },
    [append],
  );

  return {
    files,
    maxFiles: MAX_FILES,
    pickPdf: () => void pickPdf(),
    pickFromLibrary: () => void pickImage('library'),
    pickFromCamera: () => void pickImage('camera'),
    remove: (uri: string) => setFiles((current) => current.filter((f) => f.uri !== uri)),
    clear: () => setFiles([]),
  };
}

export type AttachmentsController = ReturnType<typeof useCheckinAttachments>;
