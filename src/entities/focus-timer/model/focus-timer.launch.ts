import * as IntentLauncher from 'expo-intent-launcher';

/**
 * The Focus Timer Android app. Its screens are addressed explicitly (package
 * and class), so what Tekrar hands over can only ever reach that app; the
 * timer in turn accepts these requests only from Tekrar's package.
 */
const TIMER_PACKAGE = 'com.deepwork.focustimer';

const SCREENS = {
  link: { action: `${TIMER_PACKAGE}.action.LINK_TEKRAR`, className: `${TIMER_PACKAGE}.link.LinkActivity` },
  studyTask: { action: `${TIMER_PACKAGE}.action.STUDY_TASK`, className: `${TIMER_PACKAGE}.link.StudyTaskActivity` },
} as const;

/** How a hand-over went: done, turned down on the timer, or the timer (or this screen of it) is not installed. */
export type TimerOutcome = 'done' | 'cancelled' | 'missing';

async function open(screen: keyof typeof SCREENS, extra: Record<string, string>): Promise<TimerOutcome> {
  try {
    const result = await IntentLauncher.startActivityAsync(SCREENS[screen].action, {
      packageName: TIMER_PACKAGE,
      className: SCREENS[screen].className,
      extra,
    });
    return result.resultCode === IntentLauncher.ResultCode.Success ? 'done' : 'cancelled';
  } catch {
    return 'missing';
  }
}

/** Opens the timer's pairing screen with a freshly issued token. */
export function handOverLink(link: { token: string; endpoint: string; apiKey: string; account: string }) {
  return open('link', link);
}

export interface TimerTaskTarget {
  taskId: string;
  taskTitle: string;
  topicId: string;
  topicTitle: string;
  courseId: string;
  courseLabel: string;
}

/** Opens the timer with this task picked, ready to start. */
export function openTaskInFocusTimer(target: TimerTaskTarget) {
  return open('studyTask', { ...target });
}
