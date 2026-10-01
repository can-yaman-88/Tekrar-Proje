// POST /functions/v1/daily-checkin  { dailyLogId }
//
// 1. Authenticate the caller and claim the pending daily_log (idempotent).
// 2. Load the student's open tasks and topics (RLS-scoped).
// 3. Two LLM readers in parallel — what happened, and what should change —
//    each Zod-validated (salvaged item by item if one part is malformed),
//    merged, with short handles turned back into ids.
// 4. Deterministic planner → status changes, SM-2 reviews, rescheduled tasks.
// 5. Persist everything in one transaction via public.apply_daily_checkin.
// 6. Describe the changes and answer the report's questions from the new plan.
import {
  type CheckinChange,
  CheckinPlanSchema,
  CheckinProgressSchema,
  DailyCheckinRequestSchema,
  type DailyCheckinResponse,
} from '../_shared/contracts/daily-checkin.contract.ts';
import { getEnv } from '../_shared/env.ts';
import { HttpError, LlmError } from '../_shared/errors.ts';
import { createHandler, jsonResponse, readJson } from '../_shared/http.ts';
import { createLlmProvider } from '../_shared/llm/index.ts';
import { readUserLlmSettings } from '../_shared/user-model.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { authenticate, createServiceClient } from '../_shared/supabase.ts';
import { answerQuestions } from './answers.ts';
import { prepareAttachments } from './attachments.ts';
import { describePlan } from './describe.ts';
import { relativeDay } from './format.ts';
import { planCheckinEffects } from './planner.ts';
import { buildUserPrompt, PLAN_PROMPT, PROGRESS_PROMPT } from './prompt.ts';
import { CheckinRepository, type UndoneReport } from './repository.ts';
import { salvageWith } from './salvage.ts';

Deno.serve(
  createHandler('daily-checkin', async (req, { log, identify }) => {
    const env = getEnv();
    const service = createServiceClient(env);
    const { userId, userClient } = await authenticate(req, env, service);
    identify(userId);
    const { dailyLogId } = DailyCheckinRequestSchema.parse(await readJson(req));
    // Before the claim: a refused call leaves the log pending, ready to retry.
    await enforceRateLimit(service, userId, 'checkin');

    const repo = new CheckinRepository(service, userClient, userId);
    const claimed = await repo.claim(dailyLogId);
    log.info('claimed', { dailyLogId, userId });

    try {
      const context = await repo.loadContext(claimed.logDate, claimed.rawText);
      const attachments = await prepareAttachments(await repo.loadAttachments(claimed.id));
      if (attachments.documents.length > 0 || attachments.images.length > 0) {
        log.info('attachments', {
          documents: attachments.documents.length,
          images: attachments.images.length,
          skipped: attachments.notes.length,
        });
      }

      const settings = await readUserLlmSettings(service, userId);
      const llm = createLlmProvider(env, settings.model, settings.apiKey);
      const { prompt, aliases } = buildUserPrompt({
        logDate: claimed.logDate,
        report: claimed.rawText,
        ...context,
        documents: attachments.documents,
        imageCount: attachments.images.length,
      });
      const startedAt = performance.now();
      // Two readers of the same report, at the same time: half the schema and
      // only their own rules each (see CheckinProgressSchema).
      const [progress, changes] = await Promise.all([
        llm.generateStructured({
          system: PROGRESS_PROMPT,
          user: prompt,
          images: attachments.images,
          schema: CheckinProgressSchema,
          schemaName: 'checkin_progress',
          salvage: salvageWith(CheckinProgressSchema),
          // Each reader reserves only its share. OpenRouter holds the whole
          // output limit against the balance before answering, and two full
          // reservations refused reports that would have cost cents.
          maxOutputTokens: Math.round((env.LLM_MAX_OUTPUT_TOKENS * 3) / 8),
        }),
        llm.generateStructured({
          system: PLAN_PROMPT,
          user: prompt,
          images: attachments.images,
          schema: CheckinPlanSchema,
          schemaName: 'checkin_plan',
          salvage: salvageWith(CheckinPlanSchema),
          // The larger share: "tüm görevleri İngilizce yap" writes a title per task.
          maxOutputTokens: Math.round((env.LLM_MAX_OUTPUT_TOKENS * 3) / 4),
        }),
      ]);
      const model = progress.model;
      // The models spoke in handles ("T12"); from here on everything is real ids.
      const extraction = aliases.resolve({ ...progress.data, ...changes.data });
      log.info('extracted', {
        provider: llm.name,
        model,
        ms: Math.round(performance.now() - startedAt),
        outcomes: extraction.taskOutcomes.length,
        struggles: extraction.topicStruggles.length,
        attachmentTasks: extraction.attachmentTasks.length,
        plannedWork: extraction.plannedWork.length,
        removals: extraction.taskRemovals.length,
        clearances: extraction.dayClearances.length,
        dayTargets: extraction.dayTargets.length,
        bulk: extraction.bulkOutcomes.length,
        dayLoads: extraction.dayLoads.length,
        holds: extraction.courseHolds.length,
        questions: extraction.infoRequests.length,
        edits: extraction.taskEdits.length,
        groups: extraction.taskGroups.length,
        examChanges: extraction.examChanges.length,
        extraWork: extraction.extraWork.length,
        examResults: extraction.examResults.length,
        examPlans: extraction.examPlans.length,
        priorities: extraction.priorities.length,
        reminders: extraction.reminders.length,
        undo: extraction.undoPreviousReport,
      });

      // "Az önceki raporu geri al" comes first: everything else in this report
      // is about the plan as it stands once that one is taken back.
      let undone: UndoneReport | null = null;
      let planContext = context;
      if (extraction.undoPreviousReport) {
        undone = await repo.undoPreviousReport(claimed.id);
        if (undone) planContext = await repo.loadContext(claimed.logDate, claimed.rawText);
      }

      // An exam's topics and readiness are read only for a report that needs
      // them — and only for exams that really are on the list.
      const knownExams = new Set(planContext.exams.map((exam) => exam.id));
      const resultExamIds = [...new Set(extraction.examResults.map((r) => r.examId))].filter((id) => knownExams.has(id));
      const planExamIds = [...new Set(extraction.examPlans.map((r) => r.examId))].filter((id) => knownExams.has(id));
      const [examTopicIds, cram] = await Promise.all([
        repo.loadExamTopics(resultExamIds),
        repo.loadCramContexts(planExamIds, claimed.logDate),
      ]);
      const listed = new Set(planContext.tasks.map((task) => task.id));
      const tasks = [...planContext.tasks, ...cram.sprintTasks.filter((task) => !listed.has(task.id))];

      // Only a report that moves work between days needs to know what the
      // student's week can hold; every other report pays nothing for the three
      // extra queries.
      const needsCapacity =
        extraction.dayClearances.length > 0 ||
        extraction.dayTargets.length > 0 ||
        extraction.taskReschedules.length > 0 ||
        extraction.dayLoads.length > 0 ||
        extraction.courseHolds.length > 0 ||
        extraction.reopenedWeekdays.length > 0 ||
        planExamIds.length > 0 ||
        extraction.bulkOutcomes.some((bulk) => bulk.outcome === 'not_attempted');
      const capacity = needsCapacity ? await repo.loadCapacity(claimed.logDate) : null;
      const plan = planCheckinEffects({
        logDate: claimed.logDate,
        extraction,
        ...planContext,
        tasks,
        capacityByWeekday: capacity?.capacityByWeekday,
        blockedWeekdays: capacity?.blockedWeekdays,
        examTopicIds,
        cramContexts: cram.contexts,
      });
      if (plan.droppedReferences > 0) log.info('dropped_hallucinated_ids', { count: plan.droppedReferences });

      const applied = await repo.apply(claimed.id, model, plan);

      const undoLine: CheckinChange[] = !extraction.undoPreviousReport
        ? []
        : undone
          ? [{ kind: 'removed', text: `Önceki değerlendirme (${relativeDay(undone.logDate, claimed.logDate)}) geri alındı.` }]
          : [{ kind: 'warning', text: 'Geri alınacak yakın bir değerlendirme bulamadım (son iki gün).' }];
      const described = { ...planContext, tasks };
      const body: DailyCheckinResponse = {
        dailyLogId: claimed.id,
        summary: plan.summary,
        changes: [...undoLine, ...describePlan({ plan, logDate: claimed.logDate, ...described })],
        answers: answerQuestions({ questions: plan.questions, logDate: claimed.logDate, plan, ...described }),
        reminders: plan.reminders,
        undoneLogId: undone?.id ?? null,
        coveredDates: plan.coveredDates,
        attachmentNotes: attachments.notes,
        updatedTaskIds: plan.taskUpdates.map((u) => u.task_id),
        createdTaskIds: applied.createdTaskIds,
        removedTaskIds: applied.removedTaskIds,
        movedTaskIds: applied.movedTaskIds,
        mistakesRecorded: applied.mistakesRecorded,
        reviewedTopicIds: plan.topicReviews.map((r) => r.topic_id),
        scheduledReviews: plan.topicReviews.map((review) => ({
          topicId: review.topic_id,
          topicTitle: context.topics.find((topic) => topic.id === review.topic_id)?.title ?? '',
          nextReviewOn: review.next_review_on,
          intervalDays: review.interval_days,
          early: review.early,
        })),
        unmatchedMentions: plan.unmatchedMentions,
      };
      await repo.saveResult(claimed.id, body);
      return jsonResponse(body);
    } catch (error) {
      const publicError =
        error instanceof HttpError ? error : error instanceof LlmError ? error.toHttpError() : null;
      await repo.markFailed(claimed.id, publicError?.message ?? 'Processing failed. Please retry.');
      throw error;
    }
  }),
);
