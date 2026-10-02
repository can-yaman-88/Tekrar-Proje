import { selectUserEmail, useSessionStore } from '@entities/session';
import { env } from '@shared/config/env';
import { formatShortDate, localDateOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { focusTimerLinkApi } from '../data/focus-timer-link.api';

/**
 * The Focus Timer app's pairing screen. Addressed explicitly (package and
 * class), so the token can only ever be delivered to that app; the timer in
 * turn accepts it only from Tekrar's package.
 */
const TIMER_PACKAGE = 'com.deepwork.focustimer';
const TIMER_LINK_ACTIVITY = `${TIMER_PACKAGE}.link.LinkActivity`;
const TIMER_LINK_ACTION = `${TIMER_PACKAGE}.action.LINK_TEKRAR`;

export const focusTimerLinkKeys = {
  status: ['focus-timer-link', 'status'] as const,
};

const timeOf = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

type LinkOutcome = 'linked' | 'cancelled' | 'missing';

async function handOver(account: string | null): Promise<LinkOutcome> {
  const link = await focusTimerLinkApi.issue();
  try {
    const result = await IntentLauncher.startActivityAsync(TIMER_LINK_ACTION, {
      packageName: TIMER_PACKAGE,
      className: TIMER_LINK_ACTIVITY,
      extra: {
        token: link.token,
        endpoint: `${env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/focus-timer`,
        apiKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        account: account ?? '',
      },
    });
    if (result.resultCode === IntentLauncher.ResultCode.Success) return 'linked';
    await focusTimerLinkApi.revoke(link.id);
    return 'cancelled';
  } catch {
    // The timer is not installed, or is an older build without the pairing screen.
    await focusTimerLinkApi.revoke(link.id);
    return 'missing';
  }
}

/**
 * Settings → Focus Timer: pair the timer app, see when it last reported, and
 * disconnect it. Android only — the timer is an Android app.
 */
export function useFocusTimerLink() {
  const queryClient = useQueryClient();
  const account = useSessionStore(selectUserEmail);
  const isSupported = Platform.OS === 'android';

  const statusQuery = useQuery({
    queryKey: focusTimerLinkKeys.status,
    queryFn: () => focusTimerLinkApi.status(),
    enabled: isSupported,
  });

  const link = useMutation({
    mutationFn: () => handOver(account),
    onSuccess: (outcome) => {
      if (outcome === 'linked') {
        showToast('Focus Timer bağlandı. Derslerin birazdan orada görünür.', 'success');
      } else if (outcome === 'cancelled') {
        showToast('Bağlantı kurulmadı; Focus Timer’da onay verilmedi.', 'info');
      } else {
        showToast('Focus Timer bulunamadı. Telefonda uygulamanın güncel sürümü yüklü olmalı.', 'danger');
      }
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusTimerLinkKeys.status }),
  });

  const unlink = useMutation({
    mutationFn: () => focusTimerLinkApi.revoke(),
    onSuccess: () => showToast('Focus Timer bağlantısı kaldırıldı. Kaydedilen süreler duruyor.', 'success'),
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusTimerLinkKeys.status }),
  });

  const status = statusQuery.data ?? null;
  const statusLabel = !status
    ? 'Bağlı değil.'
    : status.lastUsedAt
      ? `Bağlı · son eşitleme ${formatShortDate(localDateOf(status.lastUsedAt))} ${timeOf(status.lastUsedAt)}`
      : 'Bağlı · Focus Timer henüz veri göndermedi.';

  return {
    isSupported,
    isLoading: isSupported && statusQuery.isPending,
    isLinked: status !== null,
    statusLabel,
    isLinking: link.isPending,
    isUnlinking: unlink.isPending,
    onLink: () => link.mutate(),
    onUnlink: () => unlink.mutate(),
  };
}

export type FocusTimerLinkController = ReturnType<typeof useFocusTimerLink>;
