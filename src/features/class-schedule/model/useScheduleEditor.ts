import { zodResolver } from '@hookform/resolvers/zod';
import { classSessionKeys, classSessionRepository, type Weekday } from '@entities/class-session';
import { describeError, isAppError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { SessionFormSchema, type SessionFormOutput, type SessionFormValues } from '../domain/session.schema';

/** Add and remove timetable entries. Nothing here runs on its own. */
export function useScheduleEditor(defaultCourseId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: classSessionKeys.all });

  const form = useForm<SessionFormValues, unknown, SessionFormOutput>({
    resolver: zodResolver(SessionFormSchema),
    defaultValues: {
      courseId: defaultCourseId ?? '',
      weekday: 1,
      startTime: '09:00',
      endTime: '10:50',
      isLab: false,
      location: '',
    },
  });

  const add = useMutation({
    mutationFn: (values: SessionFormOutput) =>
      classSessionRepository.create({
        courseId: values.courseId,
        weekday: values.weekday as Weekday,
        startTime: values.startTime,
        endTime: values.endTime,
        isLab: values.isLab,
        location: values.location,
      }),
    onSuccess: async () => {
      await invalidate();
      form.reset({ ...form.getValues(), location: '' });
      showToast('Derse programa eklendi.', 'success');
    },
    onError: (error) =>
      // The unique slot constraint is the common case: say it in plain words.
      showToast(
        isAppError(error) && error.kind === 'conflict'
          ? 'Bu ders bu gün ve saatte zaten ekli.'
          : describeError(error).message,
        'danger',
      ),
  });

  const remove = useMutation({
    mutationFn: (sessionId: string) => classSessionRepository.remove(sessionId),
    onSuccess: invalidate,
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  return {
    control: form.control,
    errors: {
      courseId: form.formState.errors.courseId?.message ?? null,
      startTime: form.formState.errors.startTime?.message ?? null,
      endTime: form.formState.errors.endTime?.message ?? null,
      location: form.formState.errors.location?.message ?? null,
    },
    isSaving: add.isPending,
    onSubmit: form.handleSubmit(
      (values) => add.mutate(values),
      (errors) => {
        const first = Object.values(errors).find((error) => error?.message);
        showToast(first?.message ?? 'Formda hatalı bir alan var.', 'danger');
      },
    ),
    onRemove: (sessionId: string) => remove.mutate(sessionId),
    isRemoving: remove.isPending,
  };
}

export type ScheduleEditorController = ReturnType<typeof useScheduleEditor>;
