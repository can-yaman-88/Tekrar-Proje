import { zodResolver } from '@hookform/resolvers/zod';
import { examKeys, examRepository } from '@entities/exam';
import { addDays, todayLocal } from '@shared/lib/date';
import { describeError, isAppError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ExamFormSchema, type ExamFormOutput, type ExamFormValues } from '../domain/exam.schema';

/**
 * The manual way in. Syllabi that date their exams by week — or not at all —
 * leave the student with nothing to plan around; this is how they fill it in.
 */
export function useExamEditor(courseId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: examKeys.all });

  const form = useForm<ExamFormValues, unknown, ExamFormOutput>({
    resolver: zodResolver(ExamFormSchema),
    defaultValues: { kind: 'midterm', title: 'Vize 1', examDate: addDays(todayLocal(), 14) },
  });

  const add = useMutation({
    mutationFn: (values: ExamFormOutput) =>
      examRepository.create({ courseId, kind: values.kind, title: values.title, examDate: values.examDate }),
    onSuccess: async () => {
      await invalidate();
      showToast('Sınav eklendi.', 'success');
    },
    onError: (error) =>
      showToast(
        isAppError(error) && error.kind === 'conflict'
          ? 'Bu sınav zaten ekli.'
          : describeError(error).message,
        'danger',
      ),
  });

  const remove = useMutation({
    mutationFn: (examId: string) => examRepository.remove(examId),
    onSuccess: invalidate,
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  return {
    control: form.control,
    errors: {
      title: form.formState.errors.title?.message ?? null,
      examDate: form.formState.errors.examDate?.message ?? null,
    },
    isSaving: add.isPending,
    onSubmit: form.handleSubmit(
      (values) => add.mutate(values),
      (errors) => {
        const first = Object.values(errors).find((error) => error?.message);
        showToast(first?.message ?? 'Formda hatalı bir alan var.', 'danger');
      },
    ),
    onRemove: (examId: string) => remove.mutate(examId),
    isRemoving: remove.isPending,
  };
}

export type ExamEditorController = ReturnType<typeof useExamEditor>;
