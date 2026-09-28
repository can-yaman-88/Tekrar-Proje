import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { taskNoteRepository } from '../data/task-note.repository';

export const taskNoteKeys = {
  all: ['task-notes'] as const,
  forTask: (taskId: string) => [...taskNoteKeys.all, taskId] as const,
};

export const taskNoteMutationKeys = {
  add: [...taskNoteKeys.all, 'add'] as const,
};

export function useTaskNotes(taskId: string) {
  return useQuery({
    queryKey: taskNoteKeys.forTask(taskId),
    queryFn: () => taskNoteRepository.listForTask(taskId),
  });
}

export function useAddTaskNote(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: taskNoteMutationKeys.add,
    mutationFn: ({ body }: { taskId: string; body: string }) => taskNoteRepository.create(taskId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskNoteKeys.forTask(taskId) }),
  });
}

export function useDeleteTaskNote(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => taskNoteRepository.remove(noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskNoteKeys.forTask(taskId) }),
  });
}
