import { taskKeys, taskRepository } from '@entities/task';
import { useReviewRadar } from '@entities/topic';
import { reportError } from '@shared/api/telemetry';
import { addDays, todayLocal, useToday } from '@shared/lib/date';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import {
  requestWidgetUpdate,
  type WidgetInfo,
  type WidgetRepresentation,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';
import {
  clearWidgetData,
  readNotice,
  readSignedIn,
  readSnapshot,
  setSignedIn,
  writeNotice,
  writeSnapshot,
} from '../data/widget-storage';
import { buildWidgetSnapshot, markDone, type WidgetSnapshot } from '../domain/widget-snapshot';
import { buildWidgetView, COMPLETE_ACTION } from '../domain/widget-view';
import { DARK_PALETTE, LIGHT_PALETTE, TodayWidget } from '../ui/TodayWidget';

/** Must match the widget's `name` in app.config.ts. */
export const HOME_WIDGET_NAME = 'Today';

/** Draws from what is stored: the same picture whether the app is open or not. */
export function renderHomeWidget(info: Pick<WidgetInfo, 'height'>): WidgetRepresentation {
  const view = buildWidgetView({
    snapshot: readSnapshot(),
    today: todayLocal(),
    heightDp: info.height,
    signedIn: readSignedIn(),
    notice: readNotice(),
  });
  return { light: <TodayWidget view={view} palette={LIGHT_PALETTE} />, dark: <TodayWidget view={view} palette={DARK_PALETTE} /> };
}

/** Redraws every placed widget; a phone without one costs a single native call. */
export async function refreshHomeWidget(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await requestWidgetUpdate({ widgetName: HOME_WIDGET_NAME, renderWidget: renderHomeWidget });
  } catch (error) {
    reportError(error, { source: 'global', where: 'home-widget.refresh' });
  }
}

/** Sign-out: the widget forgets the account at once. */
export function clearHomeWidget(): void {
  clearWidgetData();
  void refreshHomeWidget();
}

/**
 * A tick on the widget. It shows at once; the server is told next, and if it
 * cannot be reached the tick is taken back with a line saying so — a task
 * must never look done on the home screen and open in the app.
 */
async function completeFromWidget(taskId: string, draw: () => void): Promise<void> {
  const before = readSnapshot();
  if (!before) return;
  writeSnapshot(markDone(before, taskId));
  writeNotice(null);
  draw();
  try {
    await taskRepository.updateStatus(taskId, 'completed', { on: todayLocal() });
  } catch (error) {
    writeSnapshot(before);
    writeNotice('İşaretlenemedi; bağlantı yok gibi. Uygulamadan dene.');
    draw();
    reportError(error, { source: 'global', where: 'home-widget.complete' });
  }
}

/**
 * Android's calls, made with or without the app on screen: draw when placed,
 * resized or due (every 30 minutes, which is also how the widget turns the
 * page at midnight), and tick a task when its circle is tapped.
 */
export async function homeWidgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== HOME_WIDGET_NAME) return;
  const draw = () => props.renderWidget(renderHomeWidget(props.widgetInfo));
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      draw();
      return;
    case 'WIDGET_CLICK': {
      const taskId = props.clickActionData?.['taskId'];
      if (props.clickAction === COMPLETE_ACTION && typeof taskId === 'string') {
        await completeFromWidget(taskId, draw);
      }
      return;
    }
    default:
      return;
  }
}

const withoutTime = (snapshot: WidgetSnapshot) => JSON.stringify({ ...snapshot, generatedAt: '' });

/**
 * While the app is open: keep the stored snapshot in step with what the app
 * knows, and redraw the widget when it changed — and once more when the app
 * goes to the background, so the home screen shows the latest.
 */
export function useHomeWidgetSync(): void {
  const today = useToday();
  const from = addDays(today, 1);
  const to = addDays(today, 2);
  // The board's own query (same key, same cache), plus the next two days.
  const board = useQuery({ queryKey: taskKeys.mission(today), queryFn: () => taskRepository.listMission(today) });
  const upcoming = useQuery({
    queryKey: [...taskKeys.all, 'home-widget', from, to] as const,
    queryFn: () => taskRepository.listBetween(from, to),
  });
  const radar = useReviewRadar();

  const snapshot = useMemo(
    () =>
      board.data && upcoming.data && radar.data
        ? buildWidgetSnapshot({
            today,
            board: board.data,
            upcoming: upcoming.data,
            reviewDates: radar.data.map((topic) => topic.nextReviewOn),
          })
        : null,
    [board.data, radar.data, today, upcoming.data],
  );
  const signature = snapshot ? withoutTime(snapshot) : null;

  useEffect(() => {
    if (!snapshot || signature === null) return;
    const stored = readSnapshot();
    const wasSignedIn = readSignedIn();
    setSignedIn(true);
    if (wasSignedIn && stored && withoutTime(stored) === signature) return;
    writeSnapshot(snapshot);
    void refreshHomeWidget();
    // The signature stands for the snapshot's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') void refreshHomeWidget();
    });
    return () => subscription.remove();
  }, []);
}

/** Mounted by the app shell for a signed-in student on Android. */
export function HomeWidgetSync(): null {
  useHomeWidgetSync();
  return null;
}
