import { z } from 'zod';

// ---------------------------------------------------------------------------
// Client ⇄ Edge Function
// ---------------------------------------------------------------------------
export const DailyCheckinRequestSchema = z.object({
  dailyLogId: z.uuid(),
});
export type DailyCheckinRequest = z.infer<typeof DailyCheckinRequestSchema>;

/** What kind of change one line of the "ne anladım" list describes; the app picks an icon from it. */
export const CheckinChangeKindSchema = z.enum([
  'done',
  'progress',
  'struggle',
  'added',
  'removed',
  'moved',
  'edited',
  'calendar',
  'warning',
]);
export type CheckinChangeKind = z.infer<typeof CheckinChangeKindSchema>;

export const CheckinChangeSchema = z.object({ kind: CheckinChangeKindSchema, text: z.string() });
export type CheckinChange = z.infer<typeof CheckinChangeSchema>;

/** A question from the report ("yarın ne var?"), answered from the plan as it stands after it. */
export const CheckinAnswerSchema = z.object({ question: z.string(), lines: z.array(z.string()) });
export type CheckinAnswer = z.infer<typeof CheckinAnswerSchema>;

/** "Yarın 9'da hatırlat": a local date and clock time, as the student meant them. */
export const CheckinReminderSchema = z.object({
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  text: z.string(),
});
export type CheckinReminder = z.infer<typeof CheckinReminderSchema>;

export const DailyCheckinResponseSchema = z.object({
  dailyLogId: z.uuid(),
  summary: z.string(),
  /**
   * Every change the report was read as, one line each. Counts alone cannot
   * show a misread; "Carnot seti → tamamlandı" can.
   */
  changes: z.array(CheckinChangeSchema).default([]),
  answers: z.array(CheckinAnswerSchema).default([]),
  /** Notifications the phone schedules; the server cannot. */
  reminders: z.array(CheckinReminderSchema).default([]),
  /** An earlier check-in this report undid: its reminders must go too. */
  undoneLogId: z.uuid().nullable().default(null),
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
  bulkOutcomes: z
    .array(
      z.object({
        daysAgo: z
          .number()
          .int()
          .nullable()
          .describe("Whose tasks: 0 = REPORT DATE's, 1 = the day before's… null = REPORT DATE's."),
        outcome: z
          .enum(['completed', 'not_attempted'])
          .describe('completed = "hepsini bitirdim"; not_attempted = "hiç çalışamadım", "hiçbirine bakamadım".'),
        courseIds: z
          .array(z.string())
          .describe('Only these courses (ids from COURSES) when the statement names some: "fizikteki her şeyi bitirdim". Empty = every course.'),
        exceptTaskIds: z
          .array(z.string())
          .describe('Tasks the statement leaves out: "Gauss hariç hepsini bitirdim". Empty when nothing is left out.'),
      }),
    )
    .describe(
      'A statement about ALL of one day\'s tasks at once: "bugünkü her şeyi bitirdim", "bugün hiç çalışamadım", ' +
        '"dünkü görevlerin hepsini yaptım", "Gauss hariç hepsini bitirdim". The app works out which tasks that ' +
        'means, so do not also list them in taskOutcomes. A task the report names on its own ("hepsini bitirdim ' +
        'ama Carnot\'ta 3 yanlışım vardı") still gets its own taskOutcomes entry, and that entry wins.',
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
        isHomework: z
          .boolean()
          .describe(
            'true for work they were GIVEN — ödev, proje, rapor, teslim. false for work they plan for ' +
              'themselves: "yarın 20 türev sorusu çözeceğim", "bir de kinematik tekrarı ekle".',
          ),
        dueInDays: z
          .number()
          .int()
          .nullable()
          .describe(
            'Homework: the deadline. Their own work: the day they will do it. Counted from REPORT DATE ' +
              '(0 = the report day, 1 = the next day) — look the day up in CALENDAR ("yarın gece 12ye kadar" = 1). ' +
              'null when no day is given, or when dueDate is used instead.',
          ),
        dueDate: z
          .string()
          .nullable()
          .describe('YYYY-MM-DD, only when they name a calendar date beyond CALENDAR ("15 Kasım\'a kadar"); else null.'),
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
        untilDaysAhead: z
          .number()
          .int()
          .nullable()
          .describe(
            'The last day when they name a stretch, counted the same way: "cumadan pazartesiye kadar yokum" = ' +
              'the Monday, "3 gün hastayım" = daysAhead + 2. null for a single day.',
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
        '"yarın hiçbir şey yapamam, görevleri dağıt", "hafta sonu yokum". The work on those days is moved ' +
        'to other days by the app — never delete it, and never list the individual tasks here. ' +
        'Empty when no day is being closed.',
    ),
  reopenedWeekdays: z
    .array(
      z.object({
        daysAhead: z
          .number()
          .int()
          .describe('Any coming day of that weekday, from CALENDAR; the app reads the weekday off it.'),
      }),
    )
    .describe(
      'A weekday they had closed for good and can work on again: "pazarları artık çalışabiliyorum", ' +
        '"cumartesi işi bıraktım". Only a standing change — a single free day is not this.',
    ),
  dayLoads: z
    .array(
      z.object({
        daysAhead: z.number().int().describe('The day, counted from REPORT DATE (0 = the report day).'),
        untilDaysAhead: z
          .number()
          .int()
          .nullable()
          .describe('Last day of a stretch ("önümüzdeki 3 gün" = 2); null for one day.'),
        minutes: z
          .number()
          .int()
          .nullable()
          .describe(
            'The time they say they have ("sadece 1 saatim var" = 60, "4 saatim var" = 240). null when they ' +
              'only say it should be lighter ("çok yoğunum", "hafif olsun") — the app decides how much lighter.',
          ),
      }),
    )
    .describe(
      'How much TIME a day can take: "yarın sadece 1 saatim var", "önümüzdeki 3 gün yoğunum, planı ' +
        'hafiflet", "cumartesi 4 saatim var". Work that no longer fits is moved by the app. No time at all ' +
        'is dayClearances; a number of TASKS is dayTargets.',
    ),
  courseHolds: z
    .array(
      z.object({
        mode: z
          .enum(['pause', 'only'])
          .describe(
            'pause = the listed courses wait ("kimyayı bu hafta dondur"); only = everything EXCEPT the ' +
              'listed courses waits ("yarın sadece fiziğe çalışacağım").',
          ),
        courseIds: z
          .array(z.string())
          .describe('Exact ids from COURSES. "Sadece vizeye çalışacağım" names the course of that exam.'),
        fromDaysAhead: z.number().int().describe('First day of the stretch, counted from REPORT DATE.'),
        untilDaysAhead: z
          .number()
          .int()
          .nullable()
          .describe('Last day ("bu hafta" = the coming Pazar, "vizeye kadar" = the day before it); null for one day.'),
      }),
    )
    .describe(
      'Whole courses set aside for some days: "bu hafta kimyayı dondur", "vize bitene kadar statiği ' +
        'ertele", "yarın sadece fiziğe çalışacağım", "bu hafta sadece vizelere odaklanacağım". The app moves ' +
        'that work past the stretch; deadlines inside it stay. One task is taskReschedules; a day is dayClearances.',
    ),
  dayTargets: z
    .array(
      z.object({
        daysAhead: z
          .number()
          .int()
          .describe(
            'The day, counted from REPORT DATE: 0 = the report day, 1 = the next day. ' +
              'For a weekday name ("pazartesi"), the number of days from REPORT DATE to that day.',
          ),
        maxMainTasks: z
          .number()
          .int()
          .describe('How many main tasks that day should carry — the number they actually said ("2 ana görev" = 2).'),
      }),
    )
    .describe(
      'How much a named day should carry: "pazartesi gününe 2 ana görev istiyorum, bu günü ona göre ' +
        'düzenle", "yarın en fazla 3 iş olsun". One entry per day, and only when they state a NUMBER — ' +
        'never infer one from "az olsun" or "hafif geçsin". Emptying a day is dayClearances, not this.',
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
        '"şu üçünü tek ödev olarak grupla", "bunlar aynı işin parçası", "konsept ve feynmanı grupla". A ' +
        'concept page and a Feynman page are never each other\'s parent: list both as children. Never group ' +
        'work on your own initiative, however alike the tasks look.',
    ),
  taskUngroups: z
    .array(z.object({ taskId: z.string().describe('Handle of the group card, or of any task inside it.') }))
    .describe(
      'Groups to take apart: "grupları dağıt", "şu grubu ayır", "separate the grouped tasks". "Hepsini" means ' +
        'every task marked "group of" in TASKS. The steps stay as tasks of their own; the empty card goes.',
    ),
  daySwaps: z
    .array(
      z.object({
        firstDaysAhead: z.number().int().describe('One day, from CALENDAR.'),
        secondDaysAhead: z.number().int().describe('The other day, from CALENDAR.'),
      }),
    )
    .describe(
      'Two days whose whole work trades places: "salı ile perşembenin görevlerini değiştir", "bugünküyle ' +
        'yarınkini takas et". Moving only some tasks is taskReschedules.',
    ),
  syllabusOrders: z
    .array(
      z.object({
        fromDaysAhead: z.number().int().describe('First day of the stretch, from CALENDAR.'),
        untilDaysAhead: z.number().int().nullable().describe('Last day; null = a week from the first.'),
        courseIds: z.array(z.string()).describe('Only these courses (COURSES handles); empty = every course.'),
      }),
    )
    .describe(
      'Put the work of a stretch in syllabus order — earliest topic week first — keeping how many tasks each ' +
        'day has: "görevleri izlencedeki konu sırasına göre diz, günlerdeki görev sayısı aynı kalsın".',
    ),
  weekTidies: z
    .array(
      z.object({
        fromDaysAhead: z.number().int().describe('First day of the stretch, from CALENDAR.'),
        untilDaysAhead: z.number().int().nullable().describe('Last day; null = a week from the first.'),
      }),
    )
    .describe(
      "Tidy a stretch by the study loop's rules — a topic's concept and Feynman pages onto one day as one " +
        'learning card, no quiz before its Feynman day, no day over its time: "haftayı düzenle", "aynı ' +
        'konunun konsept ve feynmanını aynı güne koy", "görev dağılımını toparla".',
    ),
  backlogActions: z
    .array(z.object({ action: z.enum(['spread', 'close']).describe('spread = to the coming days; close = drop them.') }))
    .describe(
      'Every overdue open task at once: "geciken işleri önümüzdeki günlere dağıt" = spread, "geciken işleri ' +
        'kapat" = close. One named late task is taskReschedules or taskRemovals.',
    ),
  examScopes: z
    .array(
      z.object({
        examId: z.string().describe('Exact handle from EXAMS.'),
        fromWeek: z.number().int().nullable().describe('First topic week it covers ("1-5. haftalar" = 1); else null.'),
        untilWeek: z.number().int().nullable().describe('Last topic week it covers ("1-5. haftalar" = 5); else null.'),
        topicIds: z.array(z.string()).describe('Topics named one by one (TOPICS handles); else empty.'),
        replace: z
          .boolean()
          .describe('true when this is the whole list ("vize ilk beş haftayı kapsıyor"); false when adding ("Carnot da dahil").'),
      }),
    )
    .describe(
      'Which topics an exam covers: "vize 1 ilk beş haftayı kapsıyor", "finalde Carnot da var". Weeks are the ' +
        "week numbers TOPICS shows for that exam's course.",
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
            'Exam day counted from REPORT DATE, looked up in CALENDAR (0 = today, 7 = a week away). ' +
              'null on delete, when only the title changed, or when exactDate is used instead.',
          ),
        exactDate: z
          .string()
          .nullable()
          .describe(
            'YYYY-MM-DD when they name a calendar date ("5 Aralık", "12.11") — never count the days to it ' +
              'yourself. An insert needs this or dateInDays. null otherwise.',
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
  extraWork: z
    .array(
      z.object({
        topicId: z.string().describe('Exact handle from TOPICS the work was on.'),
        problemsSolved: z.number().int().nullable().describe('Questions solved, when stated; else null.'),
        correctCount: z.number().int().nullable().describe('How many of them were right, when stated; else null.'),
        minutes: z.number().int().nullable().describe('Time spent, when stated ("bir saat" = 60); else null.'),
        daysAgo: z.number().int().nullable().describe('0 = REPORT DATE, 1 = the day before… null = REPORT DATE.'),
      }),
    )
    .describe(
      'Study done OUTSIDE the plan, that no task in TASKS covers: "plan dışı 15 türev sorusu çözdüm, 12 ' +
        'doğru", "fazladan bir saat kinematik tekrar yaptım". Work on a listed task is taskOutcomes, never this.',
    ),
  examResults: z
    .array(
      z.object({
        examId: z.string().describe('Exact handle from EXAMS.'),
        outcome: z
          .number()
          .int()
          .nullable()
          .describe(
            'Their verdict, 1–5: "kötü geçti" 1, "beklediğimden kötü" 2, "idare eder" 3, "iyi geçti" 4, ' +
              '"çok iyi" 5. null when they only give a score.',
          ),
        score: z.number().nullable().describe('The score they got, as stated ("65 aldım" = 65); else null.'),
        maxScore: z.number().nullable().describe('What it was out of ("40 üzerinden 30" = 40); null means 100.'),
        hardTopicIds: z
          .array(z.string())
          .describe('Handles from TOPICS they say went badly in it ("özellikle Gauss\'ta zorlandım"). Else empty.'),
      }),
    )
    .describe(
      'How an exam that has already happened went: "vizeden 65 aldım", "fizik vizesi kötü geçti, Gauss\'ta ' +
        'zorlandım". A new date is examChanges, not this.',
    ),
  priorities: z
    .array(
      z.object({
        taskId: z.string().describe('Exact handle from TASKS.'),
        urgent: z.boolean().describe('true for "acil", "önce bunu bitirmem lazım"; false for "artık acil değil".'),
      }),
    )
    .describe(
      'A task the student marks as urgent — or no longer urgent. Moving it to a day is taskReschedules, and ' +
        'only when they name a day.',
    ),
  examPlans: z
    .array(z.object({ examId: z.string().describe('Exact handle from EXAMS.') }))
    .describe(
      'They ask for a plan for an exam: "vize için plan çıkar", "sınava kadar ne çalışayım, planla". The app ' +
        'builds it the way the exam screen does.',
    ),
  reminders: z
    .array(
      z.object({
        daysAhead: z.number().int().describe('The day, from CALENDAR (0 = the report day).'),
        time: z
          .string()
          .nullable()
          .describe(
            'HH:MM, 24-hour ("9\'da" = 09:00, "akşam 8" = 20:00). With only a part of the day: sabah 09:00, ' +
              'öğlen 12:00, akşam 19:00, gece 22:00. null when no time is given.',
          ),
        text: z.string().describe('What to remind, short Turkish, in their words: "Fizik ödevini teslim et".'),
      }),
    )
    .describe('Reminders they ask for: "yarın 9\'da fizik ödevini hatırlat", "cuma akşamı quiz\'i hatırlat".'),
  undoPreviousReport: z
    .boolean()
    .describe(
      'true ONLY when they ask to take back an earlier report as a whole: "az önceki değerlendirmeyi geri al", ' +
        '"dünkü raporu iptal et, yanlış anlaşılmış". Undoing one task is never this.',
    ),
  infoRequests: z
    .array(
      z.object({
        kind: z
          .enum(['day_agenda', 'week_load', 'deadlines', 'exams', 'weak_spots', 'overdue'])
          .describe(
            'day_agenda = "yarın ne var?", "bugün ne kaldı?"; week_load = "bu hafta ne kadar işim var?"; ' +
              'deadlines = "hangi ödevlerin teslimi yakın?"; exams = "vizeye kaç gün kaldı?"; ' +
              'weak_spots = "nerelerde zayıfım?"; overdue = "geride kalan işim var mı?".',
          ),
        daysAhead: z
          .number()
          .int()
          .nullable()
          .describe('day_agenda only: the day asked about, from CALENDAR (0 = the report day). null otherwise.'),
      }),
    )
    .describe(
      'Questions the student asks. Never answer them yourself: the app answers from the plan as it stands ' +
        'after this report. Empty when they ask nothing.',
    ),
});
export type CheckinExtraction = z.infer<typeof CheckinExtractionSchema>;

// ---------------------------------------------------------------------------
// Two readers, two schemas.
//
// Every sentence a student can say became a field, and the one schema that
// held them all grew to where the guard's margin was nearly gone — and to
// where cheaper models, handed thirty lists at once, got worse at every one of
// them. So the report is read twice, at the same time: once for what HAPPENED
// (outcomes, struggles, time, results) and once for what should CHANGE (new
// work, days, courses, exams, reminders, questions). Each reader gets half the
// schema and only its own rules; the answers are merged into one extraction,
// and everything downstream is unchanged.
// ---------------------------------------------------------------------------
const field = CheckinExtractionSchema.shape;

/** What happened: the first reader. */
export const CheckinProgressSchema = z.object({
  summary: field.summary,
  taskOutcomes: field.taskOutcomes,
  bulkOutcomes: field.bulkOutcomes,
  topicStruggles: field.topicStruggles,
  unmatchedMentions: field.unmatchedMentions,
  advancedMaterialTopics: field.advancedMaterialTopics,
  timeLogs: field.timeLogs,
  mistakeResolutions: field.mistakeResolutions,
  extraWork: field.extraWork,
  examResults: field.examResults,
});

/** What should change: the second reader. */
export const CheckinPlanSchema = z.object({
  taskRemovals: field.taskRemovals,
  plannedWork: field.plannedWork,
  attachmentTasks: field.attachmentTasks,
  taskBreakdowns: field.taskBreakdowns,
  dayClearances: field.dayClearances,
  reopenedWeekdays: field.reopenedWeekdays,
  dayLoads: field.dayLoads,
  courseHolds: field.courseHolds,
  dayTargets: field.dayTargets,
  taskReschedules: field.taskReschedules,
  taskEdits: field.taskEdits,
  taskGroups: field.taskGroups,
  taskUngroups: field.taskUngroups,
  daySwaps: field.daySwaps,
  syllabusOrders: field.syllabusOrders,
  weekTidies: field.weekTidies,
  backlogActions: field.backlogActions,
  examScopes: field.examScopes,
  taskNotes: field.taskNotes,
  priorities: field.priorities,
  examChanges: field.examChanges,
  examPlans: field.examPlans,
  reminders: field.reminders,
  undoPreviousReport: field.undoPreviousReport,
  infoRequests: field.infoRequests,
});
