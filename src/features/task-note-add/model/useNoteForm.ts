import { zodResolver } from '@hookform/resolvers/zod';
import { useAddTaskNote, useDeleteTaskNote } from '@entities/task-note';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useForm } from 'react-hook-form';
import { NOTE_MAX_LENGTH, NoteFormSchema, type NoteFormValues } from '../domain/note.schema';

export function useNoteForm(taskId: string) {
  const addNote = useAddTaskNote(taskId);
  const deleteNote = useDeleteTaskNote(taskId);
  const form = useForm<NoteFormValues>({ resolver: zodResolver(NoteFormSchema), defaultValues: { body: '' } });

  return {
    control: form.control,
    error: form.formState.errors.body?.message ?? null,
    maxLength: NOTE_MAX_LENGTH,
    isSaving: addNote.isPending,
    onSubmit: form.handleSubmit(({ body }) =>
      addNote.mutate(
        { taskId, body },
        {
          onSuccess: () => form.reset({ body: '' }),
          onError: (error) => showToast(describeError(error).message, 'danger'),
        },
      ),
    ),
    onDelete: (noteId: string) =>
      deleteNote.mutate(noteId, { onError: (error) => showToast(describeError(error).message, 'danger') }),
    isDeleting: deleteNote.isPending,
  };
}

export type NoteFormController = ReturnType<typeof useNoteForm>;
