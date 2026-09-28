import { AppText, Button, Card, TextField, makeStyles } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { LlmModelController } from '../model/useLlmModelSettings';

const priceLabel = (perMillion: number | null, isFree: boolean): string =>
  isFree ? 'ücretsiz' : perMillion === null ? '' : `$${perMillion}/M token`;

export function LlmModelCard({ settings }: { settings: LlmModelController }) {
  const styles = useStyles();

  return (
    <Card style={styles.card}>
      <AppText variant="label">Yapay zekâ modeli</AppText>
      <AppText variant="caption" tone="muted">
        Değerlendirme, izlence okuma ve haftalık plan bu modelle üretilir. Anahtar sunucuda kalır;
        burada yalnızca model seçilir.
      </AppText>

      {settings.error ? (
        <View style={styles.errorBox}>
          <AppText variant="caption" tone="danger">
            {settings.error.message}
          </AppText>
          <Button label="Tekrar dene" variant="ghost" onPress={settings.retry} />
        </View>
      ) : (
        <>
          <View style={styles.currentBox}>
            <AppText variant="caption" tone="muted">
              Şu an kullanılan
            </AppText>
            <AppText variant="subtitle">{settings.effectiveModel ?? '—'}</AppText>
            <AppText variant="caption" tone="muted">
              {settings.selected === null
                ? 'Proje varsayılanı'
                : `Senin seçimin · varsayılan: ${settings.defaultModel ?? '—'}`}
            </AppText>
          </View>

          {settings.testResult ? (
            <View style={settings.testResult.ok ? styles.testOk : styles.testFail}>
              <AppText variant="caption" tone={settings.testResult.ok ? 'success' : 'danger'}>
                {settings.testResult.model}: {settings.testResult.message} ({settings.testResult.ms} ms)
              </AppText>
            </View>
          ) : null}

          <TextField
            label={`Model ara${settings.totalModels > 0 ? ` (${settings.totalModels} uygun model)` : ''}`}
            value={settings.search}
            onChangeText={settings.onSearch}
            autoCapitalize="none"
            placeholder="gemini, gpt, claude…"
          />

          {settings.isLoading ? (
            <AppText variant="caption" tone="muted">
              Model listesi alınıyor…
            </AppText>
          ) : settings.models.length === 0 ? (
            <AppText variant="caption" tone="muted">
              Eşleşen model yok.
            </AppText>
          ) : (
            <View style={styles.list}>
              {settings.models.map((model) => {
                const isSelected = model.id === settings.selected;
                return (
                  <Pressable
                    key={model.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    disabled={settings.isSaving}
                    onPress={() => settings.onSelect(model.id)}
                    style={({ pressed }) => [styles.row, isSelected && styles.rowSelected, pressed && styles.pressed]}
                  >
                    <View style={styles.rowText}>
                      <AppText variant="label" numberOfLines={1}>
                        {model.name}
                      </AppText>
                      <AppText variant="caption" tone="muted" numberOfLines={1}>
                        {model.id}
                        {priceLabel(model.promptPricePerMillion, model.isFree)
                          ? ` · ${priceLabel(model.promptPricePerMillion, model.isFree)}`
                          : ''}
                      </AppText>
                    </View>
                    {isSelected ? (
                      <AppText variant="caption" tone="primary">
                        seçili
                      </AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.actions}>
            <Button
              label={settings.isTesting ? 'Deneniyor…' : 'Seçili modeli dene'}
              variant="secondary"
              loading={settings.isTesting}
              disabled={settings.effectiveModel === null}
              onPress={() => settings.effectiveModel && settings.onTest(settings.effectiveModel)}
              style={styles.action}
            />
            {settings.selected ? (
              <Button
                label="Varsayılana dön"
                variant="ghost"
                loading={settings.isSaving}
                onPress={() => settings.onSelect(null)}
                style={styles.action}
              />
            ) : null}
          </View>
        </>
      )}
    </Card>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  card: { gap: spacing.sm },
  currentBox: { gap: spacing.xxs, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md },
  errorBox: { gap: spacing.xs },
  testOk: { backgroundColor: colors.successMuted, borderRadius: radii.sm, padding: spacing.sm },
  testFail: { backgroundColor: colors.dangerMuted, borderRadius: radii.sm, padding: spacing.sm },
  list: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  rowText: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.7 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
}));
