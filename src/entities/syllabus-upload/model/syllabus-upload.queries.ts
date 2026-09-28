import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { syllabusUploadRepository } from '../data/syllabus-upload.repository';
import { isUploadPending, isUploadVisible, type SyllabusUpload } from '../domain/syllabus-upload';

export const syllabusKeys = {
  all: ['syllabus-uploads'] as const,
  recent: () => [...syllabusKeys.all, 'recent'] as const,
};

export function useRecentUploads() {
  return useQuery({
    queryKey: syllabusKeys.recent(),
    queryFn: () => syllabusUploadRepository.listRecent(),
    // Finished-and-seen uploads drop out of the board on their own.
    select: (uploads) => uploads.filter((upload) => isUploadVisible(upload)),
    // While something is parsing, poll so the status card updates on its own.
    refetchInterval: (query) => (query.state.data?.some(isUploadPending) ? 3_000 : false),
  });
}

export function useRemoveUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (upload: Pick<SyllabusUpload, 'id' | 'storagePath'>) => syllabusUploadRepository.remove(upload),
    onSettled: () => queryClient.invalidateQueries({ queryKey: syllabusKeys.all }),
  });
}
