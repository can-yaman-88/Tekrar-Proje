import { AppText, Button, Card, Skeleton, makeStyles } from '@shared/ui';
import { Alert, View } from 'react-native';
import type { FocusTimerLinkController } from '../model/useFocusTimerLink';

export function FocusTimerCard({ link }: { link: FocusTimerLinkController }) {
  const styles = useStyles();
  if (!link.isSupported) return null;

  return (
    <Card style={styles.card}>
      <AppText variant="label">Focus Timer</AppText>
      <AppText variant="caption" tone="muted">
        Focus Timer’da ders ve konu seçip çalıştığında süre buraya gelir; ders ve konu ekranlarında, haftalık özette
        görünür. Bağlantı yalnızca ders–konu adlarını okuyup çalışma süresi yazabilir.
      </AppText>

      {link.isLoading ? (
        <Skeleton height={20} radius={6} />
      ) : (
        <AppText variant="caption" tone={link.isLinked ? 'success' : 'muted'}>
          {link.statusLabel}
        </AppText>
      )}

      <View style={styles.actions}>
        <Button
          label={link.isLinked ? 'Yeniden bağla' : 'Focus Timer’ı bağla'}
          variant={link.isLinked ? 'secondary' : 'primary'}
          loading={link.isLinking}
          onPress={link.onLink}
        />
        {link.isLinked ? (
          <Button
            label="Bağlantıyı kaldır"
            variant="ghost"
            loading={link.isUnlinking}
            onPress={() =>
              Alert.alert(
                'Bağlantıyı kaldır',
                'Focus Timer bundan sonra süre gönderemez. Şimdiye kadar gelen süreler silinmez.',
                [
                  { text: 'Vazgeç', style: 'cancel' },
                  { text: 'Kaldır', style: 'destructive', onPress: link.onUnlink },
                ],
              )
            }
          />
        ) : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
  actions: { gap: spacing.xs },
}));
