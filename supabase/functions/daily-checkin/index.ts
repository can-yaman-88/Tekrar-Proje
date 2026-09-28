// POST /functions/v1/daily-checkin  { dailyLogId }
//
// 1. Authenticate the caller and claim the pending daily_log (idempotent).
// 2. Load the student's open tasks and topics (RLS-scoped).
// 3. LLM structured output → CheckinExtraction (Zod-validated).
// 4. Deterministic planner → status changes, SM-2 reviews, rescheduled tasks.
// 5. Persist everything in one transaction via public.apply_daily_checkin.
import {
  CheckinExtractionSchema,
  DailyCheckinRequestSchema,
  type DailyCheckinResponse,
} from '../_shared/contracts/daily-checkin.contract.ts';
import { getEnv } from '../_shared/env.ts';
import { HttpError, LlmError } from '../_shared/errors.ts';
import { createHandler, jsonResponse, readJson } from '../_shared/http.ts';
import { createLlmProvider } from '../_shared/llm/index.ts';
import { readUserLlmSettings } from '../_shared/user-model.ts';
import { authenticate, createServiceClient } from '../_shared/supabase.ts';
import { prepareAttachments } from './attachments.ts';
import { planCheckinEffects } from './planner.ts';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.ts';
import { CheckinRepository } from './repository.ts';

Deno.serve(
  createHandler('daily-checkin', async (req, { log }) => {
    const env = getEnv();
    const service = createServiceClient(env);
    const { userId, userClient } = await authenticate(req, env, service);
    const { dailyLogId } = DailyCheckinRequestSchema.parse(await readJson(req));

    const repo = new CheckinRepository(service, userClient, userId);
    const claimed = await repo.claim(dailyLogId);
    log.info('claimed', { dailyLogId, userId });

    try {
      const context = await repo.loadContext(claimed.logDate);
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
      const startedAt = performance.now();
      const { data: extraction, model } = await llm.generateStructured({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          logDate: claimed.logDate,
          report: claimed.rawText,
          ...context,
          documents: attachments.documents,
          imageCount: attachments.images.length,
        }),
        images: attachments.images,
        schema: CheckinExtractionSchema,
        schemaName: 'checkin_extraction',
      });
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
        edits: extraction.taskEdits.length,
        groups: extraction.taskGroups.length,
        examChanges: extraction.examChanges.length,
      });

      // Only a report that closes a day needs to know what the student's week
      // can hold; every other report pays nothing for the three extra queries.
      const capacity = extraction.dayClearances.length > 0 ? await repo.loadCapacity(claimed.logDate) : null;
      const plan = planCheckinEffects({
        logDate: claimed.logDate,
        extraction,
        ...context,
        capacityByWeekday: capacity?.capacityByWeekday,
        blockedWeekdays: capacity?.blockedWeekdays,
      });
      if (plan.droppedReferences > 0) log.info('dropped_hallucinated_ids', { count: plan.droppedReferences });

      const applied = await repo.apply(claimed.id, model, plan);

      const body: DailyCheckinResponse = {
        dailyLogId: claimed.id,
        summary: plan.summary,
        coveredDates: plan.coveredDates,
        attachmentNotes: attachments.notes,
        updatedTaskIds: plan.taskUpdates.map((u) => u.task_id),
        createdTaskIds: applied.createdTaskIds,
        removedTaskIds: applied.removedTaskIds,
        movedTaskIds: applied.movedTaskIds,
        mistakesRecorded: applied.mistakesRecorded,
        reviewedTopicIds: plan.topicReviews.map((r) => r.topic_id),
        unmatchedMentions: plan.unmatchedMentions,
      };
      return jsonResponse(body);
    } catch (error) {
      const publicError =
        error instanceof HttpError ? error : error instanceof LlmError ? error.toHttpError() : null;
      await repo.markFailed(claimed.id, publicError?.message ?? 'Processing failed. Please retry.');
      throw error;
    }
  }),
);
