export interface Profile {
  id: string;
  displayName: string | null;
  timezone: string;
  /** Chosen model id; null means the project default. */
  llmModel: string | null;
  /**
   * The student's own provider key lives in Vault and never comes back to the
   * device. These two fields are all the app ever learns about it: enough to
   * show "a key is set, and it ends in 1a2b".
   */
  llmKeyHint: string | null;
  llmKeySetAt: string | null;
  /** When false, the Monday cron skips this student. */
  autoWeeklyPlan: boolean;
  /**
   * ISO weekdays (1 = Monday) the student can never study on. Their capacity is
   * zero everywhere, so no planner may put work on them.
   */
  blockedWeekdays: number[];
  /**
   * The student's own minutes per ISO weekday, where they know better than the
   * history. Every planner obeys it; a blocked weekday still wins.
   */
  capacityOverrides: Record<number, number>;
  /** Local hour the server pushes the day's due reviews; null = no push reminders. */
  reviewPushHour: number | null;
}
