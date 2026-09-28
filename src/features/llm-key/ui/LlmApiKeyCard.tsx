import { AppText, Button, Card, Skeleton, TextField, makeStyles } from '@shared/ui';
import { View } from 'react-native';
import type { LlmApiKeyController } from '../model/useLlmApiKey';

export function LlmApiKeyCard({ apiKey }: { apiKey: LlmApiKeyController }) {
  const styles = useStyles();

  return (
    <Card style={styles.card}>
      <AppText variant="label">Yapay zekâ anahtarı</AppText>
      <AppText variant="caption" tone="muted">
        Kendi OpenRouter anahtarını girersen değerlendirme, izlence ve haftalık plan çağrıları senin hesabından
        geçer. Anahtar sunucuda şifreli saklanır; uygulamaya bir daha inmez, bu yüzden kutucuk her zaman boş açılır.
      </AppText>

      {apiKey.isLoading ? (
        <Skeleton height={44} radius={10} />
      ) : apiKey.hasKey ? (
        <View style={styles.statusRow}>
          <AppText variant="caption" tone="success" style={styles.flex}>
            Anahtar tanımlı: {apiKey.keyLabel}
          </AppText>
          <Button label="Sil" variant="secondary" loading={apiKey.isClearing} onPress={apiKey.onClear} />
        </View>
      ) : (
        <AppText variant="caption" tone="muted">
          Şu an sunucudaki varsayılan anahtar kullanılıyor.
        </AppText>
      )}

      <TextField
        label={apiKey.hasKey ? 'Yeni anahtar' : 'OpenRouter anahtarı'}
        value={apiKey.draft}
        onChangeText={apiKey.onChangeDraft}
        placeholder="sk-or-v1-…"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        textContentType="password"
      />
      <Button
        label={apiKey.hasKey ? 'Anahtarı değiştir' : 'Anahtarı kaydet'}
        loading={apiKey.isSaving}
        disabled={!apiKey.canSave}
        onPress={apiKey.onSave}
      />
      <AppText variant="caption" tone="muted">
        Anahtarı openrouter.ai → Keys sayfasından alabilirsin. Bakiye yetmezse çağrılar “bakiye yetmedi” hatasıyla
        döner.
      </AppText>
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
}));
