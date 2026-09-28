import type { SyllabusIngestResponse } from '@contracts/syllabus.contract';
import { courseKeys } from '@entities/course';
import { examKeys } from '@entities/exam';
import { syllabusKeys, syllabusUploadRepository } from '@entities/syllabus-upload';
import { todayLocal } from '@shared/lib/date';
import { AppError, describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useRef } from 'react';
import { ingestSyllabus } from '../data/syllabus.api';

const MAX_BYTES = 20 * 1024 * 1024;

interface PickedSyllabus {
  uri: string;
  filename: string;
}

/**
 * Pick a PDF → upload to private storage → record it → ask the Edge Function
 * to parse it.
 *
 * The file is chosen *before* the mutation starts, deliberately. When picking
 * lived inside the mutation, anything that made React Query run the mutation
 * again — a retry, or resuming it after a pause — reopened the file picker in
 * the student's face, long after they had chosen their file. Picking is a
 * one-off interaction, not part of the retryable work.
 */
export function useSyllabusUpload() {
  const queryClient = useQueryClient();
  const today = todayLocal();
  // Set once the bytes are in storage, so a second attempt re-parses the file
  // that is already there instead of uploading it twice.
  const uploadedId = useRef<string | null>(null);

  const mutation = useMutation<SyllabusIngestResponse, Error, PickedSyllabus>({
    mutationKey: ['syllabus', 'upload'],
    // A syllabus parse costs real credits and is not idempotent from the
    // student's point of view: never repeat it on their behalf.
    retry: false,
    networkMode: 'always',
    mutationFn: async (file) => {
      if (uploadedId.current === null) {
        const bytes = await new File(file.uri).arrayBuffer();
        uploadedId.current = await syllabusUploadRepository.upload({
          filename: file.filename,
          bytes,
          objectName: `${Crypto.randomUUID()}.pdf`,
        });
        await queryClient.invalidateQueries({ queryKey: syllabusKeys.all });
      }
      return ingestSyllabus(uploadedId.current, today);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: courseKeys.all }),
        queryClient.invalidateQueries({ queryKey: examKeys.all }),
        queryClient.invalidateQueries({ queryKey: syllabusKeys.all }),
      ]);
      showToast(`${result.courseName}: ${result.topicsAdded} konu, ${result.examsAdded} sınav eklendi.`, 'success');
    },
    onError: (error) => {
      // The stored row keeps its own message; the toast is for the moment.
      showToast(describeError(error).message, 'danger');
      void queryClient.invalidateQueries({ queryKey: syllabusKeys.all });
    },
  });

  const pickAndUpload = useCallback(async () => {
    if (mutation.isPending) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset) return;
      if (asset.size !== undefined && asset.size !== null && asset.size > MAX_BYTES) {
        showToast('Dosya 20 MB sınırını aşıyor.', 'danger');
        return;
      }

      // A new file is a new run: the previous upload id and warnings are history.
      uploadedId.current = null;
      mutation.reset();
      mutation.mutate({ uri: asset.uri, filename: asset.name });
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : 'Dosya seçilemedi. Tekrar dene.';
      showToast(message, 'danger');
    }
  }, [mutation]);

  return {
    pickAndUpload: () => void pickAndUpload(),
    /** Parses the file already uploaded again, without asking for it again. */
    retry: () => {
      const variables = mutation.variables;
      if (variables && !mutation.isPending) mutation.mutate(variables);
    },
    canRetry: mutation.isError && mutation.variables !== undefined,
    dismissWarnings: () => mutation.reset(),
    isUploading: mutation.isPending,
    result: mutation.data ?? null,
    error: mutation.error ? describeError(mutation.error) : null,
    reset: () => mutation.reset(),
  };
}
