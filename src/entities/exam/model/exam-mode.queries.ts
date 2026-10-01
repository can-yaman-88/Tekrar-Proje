import type { IsoDate } from '@contracts/enums.contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  examModeRepository,
  type CramTaskInput,
} from '../data/exam-mode.repository';
import { examKeys } from './exam.queries';

export const examModeKeys = {
  context: (examId: string, today: IsoDate) => [...examKeys.all, 'mode', examId, today] as const,
};

export const examModeMutationKeys = {
  cram: [...examKeys.all, 'cram'] as const,
  retro: [...examKeys.all, 'retro'] as const,
};

export function useExamMode(examId: string, today: IsoDate) {
  return useQuery({
    queryKey: examModeKeys.context(examId, today),
    queryFn: () => examModeRepository.loadContext(examId, today),
  });
}

/** Refreshes the exam data; the feature layer also refreshes the task board. */
function useExamModeMutation<TArgs, TResult>(
  mutationKey: readonly unknown[],
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey,
    // Server-side work with no optimistic UI: run and report, never pause.
    networkMode: 'always',
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: examKeys.all }),
  });
}

export function useApplyCramPlan() {
  return useExamModeMutation(
    examModeMutationKeys.cram,
    ({ examId, tasks }: { examId: string; tasks: readonly CramTaskInput[] }) =>
      examModeRepository.applyCramPlan(examId, tasks),
  );
}

export function useApplyExamRetro() {
  return useExamModeMutation(
    examModeMutationKeys.retro,
    ({
      examId,
      outcome,
      note,
      flaggedTopicIds,
    }: {
      examId: string;
      outcome: number;
      note: string | null;
      flaggedTopicIds: readonly string[];
    }) => examModeRepository.applyRetro(examId, outcome, note, flaggedTopicIds),
  );
}
