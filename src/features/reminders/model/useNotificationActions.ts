import { taskKeys, taskRepository } from '@entities/task';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@shared/lib/toast';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ACTION_COMPLETE_TASK, ACTION_WRITE_CHECKIN } from '../data/notifications';

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * What the buttons on a reminder do.
 *
 * "Bitirdim" closes the task the reminder named — but only after re-reading
 * it: a weekly reminder keeps the task it was scheduled with, so by the time
 * it fires the task may already be done, edited or gone. Acting on a stale id
 * would silently corrupt the very history the plan is built from.
 */
export function useNotificationActions(): void {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    const handle = async (response: Notifications.NotificationResponse): Promise<void> => {
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      const taskId = isString(data?.taskId) ? data.taskId : null;
      const route = isString(data?.route) ? data.route : null;

      if (response.actionIdentifier === ACTION_COMPLETE_TASK && taskId) {
        try {
          const task = await taskRepository.getById(taskId);
          if (task.status === 'completed') {
            showToast('Bu görev zaten tamamlanmıştı.', 'info');
          } else {
            await taskRepository.updateStatus(taskId, 'completed');
            await queryClient.invalidateQueries({ queryKey: taskKeys.all });
            showToast(`${task.title} tamamlandı.`, 'success');
          }
        } catch {
          showToast('Görev güncellenemedi, uygulamadan işaretleyebilirsin.', 'danger');
          router.push('/');
        }
        return;
      }

      if (response.actionIdentifier === ACTION_WRITE_CHECKIN) {
        router.push('/check-in');
        return;
      }

      if (route === '/weekly-summary') router.push('/weekly-summary');
    };

    // A response that launched the app from cold start is waiting here.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) void handle(response);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => void handle(response));
    return () => subscription.remove();
  }, [queryClient, router]);
}
