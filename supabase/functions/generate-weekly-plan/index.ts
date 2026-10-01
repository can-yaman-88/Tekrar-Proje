// POST /functions/v1/generate-weekly-plan  { weekStart?, userId? }
//
// 1. Authenticate (a student's JWT, or the service key for the cron job).
// 2. Score every topic: exam proximity, spaced-repetition due dates, recent
//    failures, never-studied — all in deterministic code.
// 3. Lay the chosen work out across the week within a daily time budget.
// 4. Ask the LLM only to phrase each slot; fall back to templates if it fails.
// 5. Replace this week's untouched generated tasks in one transaction.
import {
  PlanPhrasingSchema,
  WeeklyPlanRequestSchema,
  type WeeklyPlanResponse,
} from '../_shared/contracts/weekly-plan.contract.ts';
import type { IsoDate } from '../_shared/contracts/enums.contract.ts';
import { addDays } from '../_shared/domain/dates.ts';
import { getEnv } from '../_shared/env.ts';
import { errorMessage, HttpError } from '../_shared/errors.ts';
import { createHandler, jsonResponse, readJson } from '../_shared/http.ts';
import { createLlmProvider } from '../_shared/llm/index.ts';
import { readUserLlmSettings, type UserLlmSettings } from '../_shared/user-model.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { authenticate, createServiceClient } from '../_shared/supabase.ts';
import { fallbackCopy, planWeek, type PlanSlot } from './planner.ts';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.ts';
import { WeeklyPlanRepository } from './repository.ts';

/** Monday of the week containing `date`. */
function weekStartOf(date: IsoDate): IsoDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

Deno.serve(
  createHandler('generate-weekly-plan', async (req, { log, identify }) => {
    const env = getEnv();
    const service = createServiceClient(env);
    const body = WeeklyPlanRequestSchema.parse(await readJson(req));

    // The cron job calls with the service key and names the user explicitly.
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const isCron = token === env.SUPABASE_SERVICE_ROLE_KEY;
    if (isCron && !body.userId) throw new HttpError('bad_request', 'userId is required for service-role calls.');
    const userId = isCron && body.userId ? body.userId : (await authenticate(req, env, service)).userId;
    identify(userId);
    // The Monday job is the server's own; only a student's taps count.
    if (!isCron) await enforceRateLimit(service, userId, 'weekly_plan');

    const repo = new WeeklyPlanRepository(service, userId);
    // The phone sends its own date; the Monday job sends none, and its "today"
    // is the student's own, in their time zone — never the server's UTC day.
    const today = body.today ?? (await repo.localToday());
    const weekStart = weekStartOf(body.weekStart ?? today);
    const context = await repo.loadContext(weekStart, addDays(weekStart, 6));

    const { weekEnd, slots, notes } = planWeek({
      weekStart,
      today,
      topics: context.topics,
      exams: context.exams,
      commitments: context.commitments,
      classLoad: context.classLoad,
      courseClassDays: context.courseClassDays,
      capacityByWeekday: context.capacity.minutesByWeekday,
      capacitySources: Object.fromEntries(context.capacity.days.map((day) => [day.weekday, day.source])),
      blockedWeekdays: context.capacity.days.filter((day) => day.source === 'blocked').map((day) => day.weekday),
      termStartByCourse: context.termStartByCourse,
    });
    log.info('planned', { userId, weekStart, slots: slots.length, topics: context.topics.length });

    if (slots.length === 0) {
      const empty: WeeklyPlanResponse = {
        weekStart,
        weekEnd,
        created: 0,
        replaced: 0,
        tasks: [],
        notes,
        capacityByWeekday: context.capacity.minutesByWeekday,
        learnedWeekdays: context.capacity.learnedWeekdays,
      };
      return jsonResponse(empty);
    }

    const copy = await phrase(slots, env, log, await readUserLlmSettings(service, userId));
    const applied = await repo.apply(weekStart, weekEnd, copy);

    const response: WeeklyPlanResponse = {
      weekStart,
      weekEnd,
      created: applied.inserted,
      replaced: applied.deleted,
      tasks: copy.map(({ slot, title }) => ({
        title,
        type: slot.type,
        step: slot.step,
        dueDate: slot.dueDate,
        courseLabel: slot.courseLabel,
        topicTitle: slot.topicTitle,
        estimatedMinutes: slot.estimatedMinutes,
      })),
      notes,
      capacityByWeekday: context.capacity.minutesByWeekday,
      learnedWeekdays: context.capacity.learnedWeekdays,
    };
    return jsonResponse(response);
  }),
);

/** Wording is a nicety: if the model misbehaves, the templates still ship a usable plan. */
async function phrase(
  slots: PlanSlot[],
  env: ReturnType<typeof getEnv>,
  log: { info: (event: string, data?: Record<string, unknown>) => void },
  settings: UserLlmSettings,
): Promise<{ slot: PlanSlot; title: string; instructions: string }[]> {
  const result = slots.map((slot) => ({ slot, ...fallbackCopy(slot) }));

  try {
    const llm = createLlmProvider(env, settings.model, settings.apiKey);
    const { data, model } = await llm.generateStructured({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(slots),
      schema: PlanPhrasingSchema,
      schemaName: 'plan_phrasing',
    });
    let applied = 0;
    for (const item of data.tasks) {
      const target = result[item.index];
      if (!target) continue;
      const title = item.title.trim();
      const instructions = item.instructions.trim();
      if (title) target.title = title;
      if (instructions) target.instructions = instructions;
      applied++;
    }
    log.info('phrased', { model, applied, slots: slots.length });
  } catch (error) {
    log.info('phrasing_failed_using_templates', { message: errorMessage(error) });
  }

  return result;
}
