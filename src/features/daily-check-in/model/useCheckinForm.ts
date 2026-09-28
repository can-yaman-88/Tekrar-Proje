import { zodResolver } from '@hookform/resolvers/zod';
import { describeError } from '@shared/lib/errors';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { CHECKIN_MAX_LENGTH, CheckinFormSchema, type CheckinFormValues } from '../domain/checkin.schema';
import { useCheckinAttachments } from './useCheckinAttachments';
import { useCheckinDraftStore } from './checkin-draft.store';
import { useSubmitCheckin } from './useSubmitCheckin';

export function useCheckinForm() {
  const initialDraft = useCheckinDraftStore((s) => s.draft);
  const setDraft = useCheckinDraftStore((s) => s.setDraft);
  const submit = useSubmitCheckin();
  const attachments = useCheckinAttachments();

  const form = useForm<CheckinFormValues>({
    resolver: zodResolver(CheckinFormSchema),
    defaultValues: { report: initialDraft },
    mode: 'onSubmit',
  });

  // Mirror keystrokes into the persisted draft.
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ values }) => setDraft(values.report),
      }),
    [form, setDraft],
  );

  const report = useWatch({ control: form.control, name: 'report' });

  return {
    control: form.control,
    fieldError: form.formState.errors.report?.message ?? null,
    charCount: report.length,
    maxLength: CHECKIN_MAX_LENGTH,
    attachments,
    onSubmit: form.handleSubmit(({ report: text }) =>
      submit.mutate({ report: text, attachments: attachments.files }),
    ),
    isSubmitting: submit.isPending,
    submitError: submit.error ? describeError(submit.error) : null,
    result: submit.data ?? null,
    reset: () => {
      submit.reset();
      attachments.clear();
      form.reset({ report: '' });
    },
  };
}

export type CheckinFormController = ReturnType<typeof useCheckinForm>;
