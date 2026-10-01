import { AppError } from '@shared/lib/errors';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

/** A file the student chose (or another app sent), not yet in the outbox. */
export interface PickedFile {
  uri: string;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export const MAX_FILES_AT_ONCE = 10;
// Photos of a page stay readable at this quality and a fifth of the size.
const PHOTO_QUALITY = 0.7;

export async function pickPdfs(): Promise<PickedFile[]> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return [];
  return picked.assets.slice(0, MAX_FILES_AT_ONCE).map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? 'application/pdf',
    sizeBytes: asset.size ?? null,
  }));
}

const fromImageAssets = (assets: ImagePicker.ImagePickerAsset[]): PickedFile[] =>
  assets.slice(0, MAX_FILES_AT_ONCE).map((asset) => ({
    uri: asset.uri,
    name: asset.fileName ?? null,
    mimeType: asset.mimeType ?? null,
    sizeBytes: asset.fileSize ?? null,
  }));

export async function pickImages(): Promise<PickedFile[]> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_FILES_AT_ONCE,
    quality: PHOTO_QUALITY,
  });
  return picked.canceled ? [] : fromImageAssets(picked.assets);
}

export async function takePhoto(): Promise<PickedFile[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new AppError('validation', 'Kamera izni verilmedi; telefonun ayarlarından açabilirsin.');
  }
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: PHOTO_QUALITY });
  return picked.canceled ? [] : fromImageAssets(picked.assets);
}
