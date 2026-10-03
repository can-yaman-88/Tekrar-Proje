import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { Alert, Pressable, View } from 'react-native';
import type { CodeState, FocusTimerLinkController } from '../model/useFocusTimerLink';

export function FocusTimerCard({ link }: { link: FocusTimerLinkController }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Card style={styles.card}>
      <AppText variant="label">Focus Timer</AppText>
      <AppText variant="caption" tone="muted">
        Focus Timer’da ders, konu ya da görev seçip çalıştığında süre buraya gelir; ders ve konu ekranlarında, haftalık
        özette görünür. Timer’ı birden fazla cihazda kullanabilirsin. Bağlantı yalnızca ders, konu ve görev adlarını
        okuyup çalışma süresi yazabilir.
      </AppText>

      {link.isLoading ? (
        <Skeleton height={36} radius={8} />
      ) : link.devices.length === 0 ? (
        <AppText variant="caption" tone="muted">
          Bağlı cihaz yok.
        </AppText>
      ) : (
        <View style={styles.devices}>
          {link.devices.map((device) => (
            <View key={device.id} style={styles.deviceRow}>
              <Ionicons name="phone-portrait-outline" size={16} color={colors.textMuted} />
              <View style={styles.flex}>
                <AppText numberOfLines={1}>{device.name}</AppText>
                <AppText variant="caption" tone="muted">
                  {device.status}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${device.name} bağlantısını kaldır`}
                hitSlop={10}
                disabled={link.removingId !== null}
                onPress={() =>
                  Alert.alert(
                    `${device.name} kaldırılsın mı?`,
                    'Bu cihazdaki Focus Timer bundan sonra süre gönderemez. Şimdiye kadar gelen süreler silinmez.',
                    [
                      { text: 'Vazgeç', style: 'cancel' },
                      { text: 'Kaldır', style: 'destructive', onPress: () => link.onRemove(device.id) },
                    ],
                  )
                }
              >
                <AppText variant="caption" tone={link.removingId === device.id ? 'muted' : 'danger'}>
                  {link.removingId === device.id ? 'Kaldırılıyor…' : 'Kaldır'}
                </AppText>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {link.code ? <CodePanel code={link.code} link={link} /> : null}

      <View style={styles.actions}>
        {link.canLinkThisPhone ? (
          <Button
            label="Bu telefondaki Focus Timer’ı bağla"
            variant={link.devices.length === 0 ? 'primary' : 'secondary'}
            loading={link.isLinkingThisPhone}
            onPress={link.onLinkThisPhone}
          />
        ) : null}
        {link.code?.kind !== 'waiting' ? (
          <Button
            label="Başka bir cihaz için kod al"
            variant={link.canLinkThisPhone || link.devices.length > 0 ? 'secondary' : 'primary'}
            loading={link.isIssuingCode}
            onPress={link.onIssueCode}
          />
        ) : null}
      </View>
    </Card>
  );
}

function CodePanel({ code, link }: { code: CodeState; link: FocusTimerLinkController }) {
  const styles = useStyles();

  if (code.kind === 'linked') {
    return (
      <View style={styles.panel}>
        <AppText variant="label" tone="success">
          {code.deviceName} bağlandı.
        </AppText>
        <Button label="Tamam" variant="ghost" onPress={link.onCloseCode} />
      </View>
    );
  }

  if (code.kind === 'expired') {
    return (
      <View style={styles.panel}>
        <AppText variant="caption" tone="muted">
          Kodun süresi doldu. Gerekirse yenisini al.
        </AppText>
        <Button label="Kapat" variant="ghost" onPress={link.onCloseCode} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <AppText variant="caption" tone="muted">
        Diğer cihazda Focus Timer’ı aç: DATA → TEKRAR → CONNECT WITH CODE, ve bu kodu yaz.
      </AppText>
      <AppText variant="display" style={styles.code} selectable accessibilityLabel={code.code.split('').join(' ')}>
        {code.code}
      </AppText>
      <AppText variant="caption" tone="muted" style={styles.center}>
        Bir kez kullanılır; son geçerlilik saati {code.validUntil}. Cihaz bağlanınca burada görünür.
      </AppText>
      <Button label="Vazgeç" variant="ghost" onPress={link.onCloseCode} />
    </View>
  );
}

const useStyles = makeStyles(({ spacing, colors, radii }) => ({
  card: { gap: spacing.sm },
  devices: { gap: spacing.sm },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  panel: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  code: { textAlign: 'center', letterSpacing: 4, fontVariant: ['tabular-nums'], marginVertical: spacing.xs },
  center: { textAlign: 'center' },
  actions: { gap: spacing.xs },
}));
