import { z } from 'zod';

// ---------------------------------------------------------------------------
// Client ⇄ Edge Function
// ---------------------------------------------------------------------------
export const DailyCheckinRequestSchema = z.object({
  dailyLogId: z.uuid(),
});
export type DailyCheckinRequest = z.infer<typeof DailyCheckinRequestSchema>;

export const DailyCheckinResponseSchema = z.object({
  dailyLogId: z.uuid(),
  summary: z.string(),
  /** Days the report covered, oldest first — a catch-in may cover several. */
  coveredDates: z.array(z.string()).default([]),
  /** Warnings about attachments that could not be read. */
  attachmentNotes: z.array(z.string()).default([]),
  updatedTaskIds: z.array(z.uuid()),
  createdTaskIds: z.array(z.uuid()),
  /** Tasks the report asked to drop: deleted when untouched, else set aside. */
  removedTaskIds: z.array(z.uuid()).default([]),
  /** Tasks moved to another day because the student closed the one they were on. */
  movedTaskIds: z.array(z.uuid()).default([]),
  /** New entries in the mistake book. */
  mistakesRecorded: z.number().int().default(0),
  reviewedTopicIds: z.array(z.uuid()),
  /**
   * Where each reviewed topic now sits on the schedule — the "next time" the
   * student should hear about right away, not discover in a menu.
   */
  scheduledReviews: z
    .array(
      z.object({
        topicId: z.uuid(),
        topicTitle: z.string(),
        nextReviewOn: z.string(),
        intervalDays: z.number().int(),
        /** Practice before the due day: the clock restarted, the interval did not grow. */
        early: z.boolean(),
      }),
    )
    .default([]),
  unmatchedMentions: z.array(z.string()),
});
export type DailyCheckinResponse = z.infer<typeof DailyCheckinResponseSchema>;

// ---------------------------------------------------------------------------
// LLM structured output. Kept provider-friendly: every field required,
// optionality expressed as nullable, no string-length keywords (not supported
// by every provider's strict mode; lengths are clamped by the planner).
// ---------------------------------------------------------------------------
export const CheckinOutcomeSchema = z
  .enum(['completed', 'partial', 'failed', 'not_attempted'])
  .describe(
    'completed = finished the task; partial = made progress but did not finish; ' +
      'failed = attempted and could not solve / did not understand; ' +
      'not_attempted = explicitly says they did not get to it.',
  );
export type CheckinOutcome = z.infer<typeof CheckinOutcomeSchema>;

// Bounds are intentionally not enforced here: a single out-of-range value must
// not throw away an entire check-in. `clampConfidence` in the planner decides.
const ConfidenceSchema = z
  .number()
  .int()
  .nullable()
  .describe('1 = completely lost … 5 = fully confident. null if the report gives no signal.');

export const CheckinExtractionSchema = z.object({
  summary: z
    .string()
    .describe("One sentence, in the report's language, summarising the day's progress."),
  taskOutcomes: z
    .array(
      z.object({
        taskId: z.string().describe('Exact id copied from the TASKS list. Never invent ids.'),
        outcome: CheckinOutcomeSchema,
        problemsSolved: z
          .number()
          .int()
          .nullable()
          .describe(
            'Problems solved. Normally what was solved in THIS session; when correctsEarlierReport ' +
              'is true it is the corrected TOTAL for the task. null if no number is stated.',
          ),
        correctCount: z
          .number()
          .int()
          .nullable()
          .describe(
            'How many of the solved questions were CORRECT ("10 soruda 6 doğru" = 6, ' +
              '"4 yanlışım vardı" with 10 solved = 6). Never the number solved, and null ' +
              'when the report says nothing about right and wrong.',
          ),
        daysAgo: z
          .number()
          .int()
          .nullable()
          .describe(
            'Which day this happened: 0 = today, 1 = yesterday, 2 = the day before, and so on. ' +
              'Only when the report says so ("dün", "pazartesi", "önceki gün"); null means today.',
          ),
        correctsEarlierReport: z
          .boolean()
          .describe(
            'true when the student is correcting something they reported before ' +
              '("actually I only solved 20", "I miscounted", "I was wrong about that"). ' +
              'Tasks already marked done may be corrected back.',
          ),
        confidence: ConfidenceSchema,
        weakConcept: z
          .string()
          .nullable()
          .describe('Short label for what they struggled with (e.g. "Mol hesapları"), else null.'),
        weakResolved: z
          .boolean()
          .describe(
            'true when they got past it in the same sitting — "sonra anladım", "hallettim", ' +
              '"çözdüm", "kitaba bakınca oturdu". false when they are still stuck with it. ' +
              'A difficulty they solved is not a weakness to schedule against.',
          ),
        weakDetail: z
          .string()
          .nullable()
          .describe(
            'What exactly went wrong, in the STUDENT\'S OWN WORDS — keep their sentence, only trimmed: ' +
              '"molde hesaplamalarda takıldım", "birim çevirirken paydayı ters aldım". ' +
              'This is what they will read before the next round, so never shorten it to the label. ' +
              'null when they said they struggled but not with what.',
          ),
      }),
    ),
  topicStruggles: z
    .array(
      z.object({
        topicId: z.string().describe('Exact id copied from the TOPICS list.'),
        concept: z.string().describe('Short label for the concept they struggled with.'),
        detail: z
          .string()
          .nullable()
          .describe(
            "What exactly went wrong, in the student's own words. null when they gave no detail.",
          ),
        resolved: z
          .boolean()
          .describe('true when they worked it out in the same sitting ("sonra anladım", "hallettim").'),
        confidence: ConfidenceSchema,
        daysAgo: z.number().int().nullable().describe('0 = today, 1 = yesterday… null means today.'),
      }),
    )
    .describe('Struggles that do not correspond to any listed task.'),
  unmatchedMentions: z
    .array(z.string())
    .describe('Short quotes of report parts you could not map to any task or topic.'),
  advancedMaterialTopics: z
    .array(
      z.object({
        topicId: z.string().describe('Exact id from the TOPICS list.'),
        hasAdvancedMaterial: z
          .boolean()
          .describe('true when the student says they HAVE harder problems for it, false when they say they ran out.'),
      }),
    )
    .describe(
      'Only when the student explicitly mentions having (or no longer having) advanced/harder problem ' +
        'material for a topic — e.g. "elimde şu konudan zor sorular var". Empty otherwise.',
    ),
  taskRemovals: z
    .array(
      z.object({
        taskId: z.string().describe('Exact id copied from the TASKS list. Never invent ids.'),
        reason: z
          .string()
          .nullable()
          .describe('Short Turkish quote or reason, e.g. "ilk hafta konuları işlenmedi". null if none given.'),
      }),
    )
    .describe(
      'Tasks the student asks to get rid of: "sil", "kaldır", "gerek yok", "bu konu işlenmedi", ' +
        '"bunu yapmayacağım". List every matching task id from TASKS — if they say "bu haftaki ' +
        'İngilizce görevlerini sil", every English task of that week goes here. ' +
        'Respect the scope they state: "sadece ilk haftanın" means first-week tasks only. ' +
        'Never put a task here just because it was not done; that is not_attempted.',
    ),
  plannedWork: z
    .array(
      z.object({
        topicId: z
          .string()
          .nullable()
          .describe(
            'Exact id from the TOPICS list this work belongs to. null when the report names a course ' +
              'but no topic you can match — then replacesTaskIds decides where it lands.',
          ),
        title: z.string().describe('Short Turkish, action-first title, e.g. "İngilizce ödevi".'),
        type: z
          .enum(['problem_set', 'concept_review', 'derivation', 'spaced_review', 'mock_exam'])
          .describe('problem_set for homework and question sets; the others only when clearly stated.'),
        problemCount: z.number().int().nullable().describe('Number of questions if stated, else null.'),
        dueInDays: z
          .number()
          .int()
          .nullable()
          .describe(
            'Deadline counted from REPORT DATE: 0 = the report day itself, 1 = the next day, 2 = two days later. ' +
              'Work it out from what they wrote ("yarın gece 12ye kadar" = 1, "pazartesi" = days until that ' +
              'weekday). null when no deadline is given.',
          ),
        instructions: z.string().nullable().describe('One Turkish sentence on how to attack it, else null.'),
        subtasks: z
          .array(z.string())
          .describe(
            'Named parts of this work, when the report spells them out — "ödevin üç bölümü var: ' +
              '1-8 sorular, grafik, rapor". Each becomes a step under the task. Leave empty when ' +
              'the report does not break the work up; never invent parts.',
          ),
        replacesTaskIds: z
          .array(z.string())
          .describe(
            'Ids of existing tasks this work makes unnecessary — "bu ödev bu haftaki 3 görevi karşılar", ' +
              '"ödevler soru çözme kısmını karşılıyor". Those tasks are removed and this one takes their ' +
              'place. Empty when it replaces nothing.',
          ),
      }),
    )
    .describe(
      'Work the student states in the REPORT ITSELF — homework, assignments, deadlines they were given. ' +
        'Not what they did (that is taskOutcomes) and not what a file says (that is attachmentTasks). ' +
        'Empty when the report mentions no new work.',
    ),
  dayClearances: z
    .array(
      z.object({
        daysAhead: z
          .number()
          .int()
          .describe(
            'The day to empty, counted from REPORT DATE: 0 = the report day, 1 = the next day. ' +
              'For a weekday name ("pazar"), the number of days from REPORT DATE to that day.',
          ),
        spreadFromDaysAhead: z
          .number()
          .int()
          .nullable()
          .describe(
            'Where the redistribution may start, counted the same way: "bugünden başlayarak" = 0, ' +
              '"yarından itibaren" = 1. null when they do not say.',
          ),
        everyWeek: z
          .boolean()
          .describe(
            'true only when they say it repeats — "pazarları hiç çalışamam", "her cumartesi işteyim". ' +
              'A single day off ("bu pazar", "yarın hastanedeyim") is false.',
          ),
        reason: z.string().nullable().describe('Short Turkish quote, e.g. "o gün hiçbir şey yapamam". null if none.'),
      }),
    )
    .describe(
      'Days the student says they cannot study on, and asks to be emptied: "pazar gününü boşalt", ' +
        '"yarın hiçbir şey yapamam, görevleri dağıt". The work on that day is moved to other days ' +
        'by the app — never delete it, and never list the individual tasks here. ' +
        'Empty when no day is being closed.',
    ),
  taskReschedules: z
    .array(
      z.object({
        taskId: z.string().describe('Exact id copied from the TASKS list. Never invent ids.'),
        dueInDays: z
          .number()
          .int()
          .describe('The day it should move to, counted from REPORT DATE: 0 = the report day, 1 = the next day.'),
      }),
    )
    .describe(
      'A single task the student asks to move to another day: "bunu cumaya al", "fizik ödevini ' +
        'pazartesiye ertele". Only for a stated move — not for work they simply did not do, ' +
        'which is outcome = not_attempted.',
    ),
  taskBreakdowns: z
    .array(
      z.object({
        taskId: z.string().describe('Exact id copied from the TASKS list.'),
        steps: z.array(z.string()).describe('Short Turkish step titles, in the order they will be done.'),
      }),
    )
    .describe(
      'Only when the student ASKS for a task to be broken into steps — "fizik ödevini üç adıma böl", ' +
        '"bunu parçalara ayır". Never split a task on your own initiative, however large it looks.',
    ),
  attachmentTasks: z
    .array(
      z.object({
        topicId: z.string().describe('Exact id from the TOPICS list this work belongs to.'),
        title: z.string().describe('Short Turkish, action-first title, e.g. "Ödev 3: 1-8 arası soruları çöz".'),
        type: z
          .enum(['problem_set', 'concept_review', 'derivation', 'spaced_review', 'mock_exam'])
          .describe('problem_set for homework question sets.'),
        problemCount: z.number().int().nullable().describe('Number of questions if countable, else null.'),
        dueDate: z
          .string()
          .nullable()
          .describe('YYYY-MM-DD only when the file states a deadline; otherwise null and the app schedules it.'),
        instructions: z.string().nullable().describe('One Turkish sentence on how to attack it, else null.'),
      }),
    )
    .describe(
      'Work found in the ATTACHMENTS (homework sheets, problem lists, lab handouts). ' +
        'Empty when there are no attachments or they contain no actionable work.',
    ),
  taskEdits: z
    .array(
      z.object({
        taskId: z.string().describe('Exact id copied from the TASKS list. Never invent ids.'),
        newTitle: z
          .string()
          .nullable()
          .describe('A new title when they rename the work ("buna artık rapor de"); null to keep it.'),
        instructions: z
          .string()
          .nullable()
          .describe('New Turkish instructions when they say how it should be done; null to keep them.'),
        type: z
          .enum(['concept_note', 'quiz', 'feynman', 'problem_set', 'concept_review', 'derivation', 'spaced_review', 'mock_exam'])
          .nullable()
          .describe('Only when they say the work is really a different kind of step; null otherwise.'),
        targetCount: z
          .number()
          .int()
          .nullable()
          .describe('New number of questions ("20 soruya indir", "10 değil 25 soruymuş"); null to keep it.'),
        estimatedMinutes: z
          .number()
          .int()
          .nullable()
          .describe('New estimate in minutes ("bu bir saat sürer"); null to keep it.'),
        startsInDays: z
          .number()
          .int()
          .nullable()
          .describe(
            'When the work may START, counted from REPORT DATE ("buna cumadan önce başlayamam" = ' +
              'days until Friday). The deadline is NOT set here. null to keep it.',
          ),
        dayMinutes: z
          .array(
            z.object({
              daysAhead: z.number().int().describe('Day counted from REPORT DATE: 0 = today, 1 = tomorrow.'),
              minutes: z.number().int().describe('Minutes to spend on that day. 0 closes the day for this work.'),
            }),
          )
          .describe(
            'Only when they divide the work over named days themselves — "cuma 60 dakika, cumartesi 30". ' +
              'Empty when they do not, and the app keeps deciding.',
          ),
      }),
    )
    .describe(
      'Changes to work that already exists, when the student corrects or re-specifies it: ' +
        '"fizik ödevi 10 değil 25 soruymuş", "bunun adı rapor olsun", "bu bir saat sürer". ' +
        'This is not how a task gets DONE (taskOutcomes), removed (taskRemovals) or moved to ' +
        'another day (taskReschedules). Empty when nothing is being re-specified.',
    ),
  taskGroups: z
    .array(
      z.object({
        parentTaskId: z
          .string()
          .nullable()
          .describe('The task that becomes the whole, when it is one of the listed tasks; else null.'),
        newParentTitle: z
          .string()
          .nullable()
          .describe(
            'Short Turkish title for a new container when the group has no natural owner among the ' +
              'tasks ("fizik ödevleri" for three separate physics tasks); null when parentTaskId is set.',
          ),
        childTaskIds: z
          .array(z.string())
          .describe('Exact ids of the tasks that become steps of the whole. At least two, unless parentTaskId is set.'),
      }),
    )
    .describe(
      'Only when the student asks for existing tasks to be gathered into one piece of work: ' +
        '"şu üçünü tek ödev olarak grupla", "bunlar aynı işin parçası". Never group work on your ' +
        'own initiative, however alike the tasks look.',
    ),
  taskNotes: z
    .array(
      z.object({
        taskId: z.string().describe('Exact id copied from the TASKS list.'),
        body: z.string().describe("The note in the student's own words, Turkish, one or two sentences."),
      }),
    )
    .describe(
      'Something to remember against a specific task, stated as a note rather than as progress: ' +
        '"bu ödevde hocanın verdiği formül tablosunu kullanacakmışız", "sunum salı sabahı". ' +
        'Not a struggle (that is topicStruggles) and not a result (that is taskOutcomes).',
    ),
  timeLogs: z
    .array(
      z.object({
        taskId: z.string().describe('Exact id copied from the TASKS list.'),
        minutes: z.number().int().describe('Minutes spent, as stated ("bir buçuk saat" = 90).'),
        daysAgo: z.number().int().nullable().describe('0 = REPORT DATE, 1 = the day before it. null = the report day.'),
      }),
    )
    .describe(
      'Time the student says they spent on a task — "fizik ödevine 40 dakika harcadım", ' +
        '"iki saat kinematik çalıştım". Only when a duration is actually stated; never estimated ' +
        'from how much work they got through.',
    ),
  examChanges: z
    .array(
      z.object({
        action: z
          .enum(['insert', 'update', 'delete'])
          .describe('insert = an exam they have just been told about; update = its date/title/kind changed; delete = called off.'),
        examId: z.string().nullable().describe('Exact id from the EXAMS list for update and delete; null for insert.'),
        courseId: z.string().nullable().describe('Exact id from the COURSES list for insert; null otherwise.'),
        kind: z
          .enum(['midterm', 'final', 'quiz', 'other'])
          .nullable()
          .describe('The kind of exam, when stated or clear from the word they used; null to keep it.'),
        title: z.string().nullable().describe('Short Turkish title, e.g. "Fizik vize"; null to keep the existing one.'),
        dateInDays: z
          .number()
          .int()
          .nullable()
          .describe(
            'Exam day counted from REPORT DATE (0 = today, 7 = a week away; for a weekday name count ' +
              'the days until it). Required for insert; null on delete or when only the title changed.',
          ),
      }),
    )
    .describe(
      'Changes to the exam calendar the report announces: "vize 5 aralığa ertelendi", ' +
        '"gelecek salı kimya quizi var", "final iptal oldu". Empty when no exam is mentioned. ' +
        'Never invent an exam from a study plan ("vizeye çalışmaya başladım" is not a new exam).',
    ),
  mistakeResolutions: z
    .array(
      z.object({
        mistakeId: z.string().describe('Exact id from the OPEN MISTAKES list. Never invent ids.'),
      }),
    )
    .describe(
      'Entries in the mistake book the student says they have now: "mol hesaplarını artık ' +
        'çözüyorum", "geçen takıldığım bağıl hız meselesi oturdu". Only for entries listed in ' +
        'OPEN MISTAKES, and only when they say it is behind them.',
    ),
});
export type CheckinExtraction = z.infer<typeof CheckinExtractionSchema>;
