import {
  focusTimerKeys,
  focusTimerLinkRepository,
  focusTimerSupported,
  handOverLink,
  useFocusTimerDevices,
  type FocusTimerDevice,
  type TimerOutcome,
} from '@entities/focus-timer';
import { selectUserEmail, useSessionStore } from '@entities/session';
import { env } from '@shared/config/env';
import { formatShortDate, localDateOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { deviceThatUsed, displayCode, type OpenCode } from './pairing-code.model';

const timeOf = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const deviceName = (device: FocusTimerDevice): string => device.label ?? 'Adı bilinmeyen cihaz';

export interface DeviceRow {
  id: string;
  name: string;
  status: string;
}

/** A pairing code on screen: waiting to be typed in, used by a device, or out of time. */
export type CodeState =
  | { kind: 'waiting'; code: string; validUntil: string }
  | { kind: 'linked'; deviceName: string }
  | { kind: 'expired' };

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
 * Settings → Focus Timer: the devices the timer is paired on, each with its
 * last report and its own remove. The timer on this phone is paired directly
 * (Android); any other device with a code typed into its timer, so Tekrar
 * need not be installed there.
 */
export function useFocusTimerLink() {
  const queryClient = useQueryClient();
  const account = useSessionStore(selectUserEmail);
  const [openCode, setOpenCode] = useState<OpenCode | null>(null);

  // Moves only when the open code runs out, so the card turns over on time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!openCode) return;
    const left = Date.parse(openCode.code.expiresAt) - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left + 250);
    return () => clearTimeout(timer);
  }, [openCode]);
  const expired = openCode !== null && now >= Date.parse(openCode.code.expiresAt);

  const devicesQuery = useFocusTimerDevices({
    pollWhile: (devices) => openCode !== null && !expired && !deviceThatUsed(devices, openCode),
  });
  const claimedBy = deviceThatUsed(devicesQuery.data, openCode);

  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: focusTimerKeys.devices });

  const linkThisPhone = useMutation({
    mutationFn: () => pair(account),
    onSuccess: (outcome) => {
      if (outcome === 'done') {
        showToast('Focus Timer bağlandı. Derslerin ve bu haftanın görevleri birazdan orada.', 'success');
      } else if (outcome === 'cancelled') {
        showToast('Bağlantı kurulmadı; Focus Timer’da onay verilmedi.', 'info');
      } else {
        showToast('Focus Timer bu telefonda bulunamadı. Başka bir cihazdaysa “Başka bir cihaz için kod al” ile bağla.', 'danger');
      }
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: refreshDevices,
  });

  const issueCode = useMutation({
    mutationFn: async (): Promise<OpenCode> => {
      const [code, devices] = await Promise.all([
        focusTimerLinkRepository.issueCode(),
        focusTimerLinkRepository.devices(),
      ]);
      queryClient.setQueryData(focusTimerKeys.devices, devices);
      return { code, known: new Set(devices.map((device) => device.id)) };
    },
    onSuccess: setOpenCode,
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const remove = useMutation({
    mutationFn: (device: FocusTimerDevice) => focusTimerLinkRepository.revoke(device.id),
    onSuccess: (_, device) =>
      showToast(`${deviceName(device)} kaldırıldı. Kaydedilen süreler duruyor.`, 'success'),
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: refreshDevices,
  });

  const devices = useMemo(() => devicesQuery.data ?? [], [devicesQuery.data]);
  const rows: DeviceRow[] = useMemo(
    () =>
      devices.map((device) => ({
        id: device.id,
        name: deviceName(device),
        status: device.lastUsedAt
          ? `Son eşitleme ${formatShortDate(localDateOf(device.lastUsedAt))} ${timeOf(device.lastUsedAt)}`
          : 'Henüz veri göndermedi',
      })),
    [devices],
  );

  const code: CodeState | null = !openCode
    ? null
    : claimedBy
      ? { kind: 'linked', deviceName: deviceName(claimedBy) }
      : expired
        ? { kind: 'expired' }
        : { kind: 'waiting', code: displayCode(openCode.code.code), validUntil: timeOf(openCode.code.expiresAt) };

  return {
    canLinkThisPhone: focusTimerSupported,
    isLoading: devicesQuery.isPending,
    devices: rows,
    isLinkingThisPhone: linkThisPhone.isPending,
    onLinkThisPhone: () => linkThisPhone.mutate(),
    code,
    isIssuingCode: issueCode.isPending,
    onIssueCode: () => issueCode.mutate(),
    onCloseCode: () => {
      setOpenCode(null);
      // A device that paired again retires its older pairing on its first report.
      void refreshDevices();
    },
    removingId: remove.isPending ? remove.variables.id : null,
    onRemove: (id: string) => {
      const device = devices.find((candidate) => candidate.id === id);
      if (device) remove.mutate(device);
    },
  };
}

export type FocusTimerLinkController = ReturnType<typeof useFocusTimerLink>;
