import {
  focusTimerKeys,
  focusTimerLinkRepository,
  focusTimerSupported,
  handOverLink,
  useFocusTimerLinkStatus,
  type TimerOutcome,
} from '@entities/focus-timer';
import { selectUserEmail, useSessionStore } from '@entities/session';
import { env } from '@shared/config/env';
import { formatShortDate, localDateOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const timeOf = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** Issues a token and hands it to the timer; a hand-over that does not finish withdraws it again. */
async function pair(account: string | null): Promise<TimerOutcome> {
  const link = await focusTimerLinkRepository.issue();
  const outcome = await handOverLink({
    token: link.token,
    endpoint: `${env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/focus-timer`,
    apiKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    account: account ?? '',
  });
  if (outcome !== 'done') await focusTimerLinkRepository.revoke(link.id);
  return outcome;
}

/**
 * Settings → Focus Timer: pair the timer app, see when it last reported, and
 * disconnect it. Android only — the timer is an Android app.
 */
export function useFocusTimerLink() {
  const queryClient = useQueryClient();
  const account = useSessionStore(selectUserEmail);
  const statusQuery = useFocusTimerLinkStatus();

  const link = useMutation({
    mutationFn: () => pair(account),
    onSuccess: (outcome) => {
      if (outcome === 'done') {
        showToast('Focus Timer bağlandı. Derslerin ve bu haftanın görevleri birazdan orada.', 'success');
      } else if (outcome === 'cancelled') {
        showToast('Bağlantı kurulmadı; Focus Timer’da onay verilmedi.', 'info');
      } else {
        showToast('Focus Timer bulunamadı. Telefonda uygulamanın güncel sürümü yüklü olmalı.', 'danger');
      }
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusTimerKeys.status }),
  });

  const unlink = useMutation({
    mutationFn: () => focusTimerLinkRepository.revoke(),
    onSuccess: () => showToast('Focus Timer bağlantısı kaldırıldı. Kaydedilen süreler duruyor.', 'success'),
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusTimerKeys.status }),
  });

  const status = statusQuery.data ?? null;
  const statusLabel = !status
    ? 'Bağlı değil.'
    : status.lastUsedAt
      ? `Bağlı · son eşitleme ${formatShortDate(localDateOf(status.lastUsedAt))} ${timeOf(status.lastUsedAt)}`
      : 'Bağlı · Focus Timer henüz veri göndermedi.';

  return {
    isSupported: focusTimerSupported,
    isLoading: focusTimerSupported && statusQuery.isPending,
    isLinked: status !== null,
    statusLabel,
    isLinking: link.isPending,
    isUnlinking: unlink.isPending,
    onLink: () => link.mutate(),
    onUnlink: () => unlink.mutate(),
  };
}

export type FocusTimerLinkController = ReturnType<typeof useFocusTimerLink>;
