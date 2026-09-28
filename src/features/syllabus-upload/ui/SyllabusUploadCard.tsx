import Ionicons from '@expo/vector-icons/Ionicons';
import { isUploadPending, type SyllabusUpload } from '@entities/syllabus-upload';
import { AppText, Button, Card, makeStyles, useTheme } from '@shared/ui';
import { ActivityIndicator, Pressable, View } from 'react-native';

export interface SyllabusUploadCardProps {
  uploads: readonly SyllabusUpload[];
  isUploading: boolean;
  onPick: () => void;
  /** Re-parses the file already uploaded, without asking for it again. */
  onRetry: () => void;
  canRetry: boolean;
  warnings: readonly string[];
  onDismissWarnings: () => void;
  onRemove: (upload: SyllabusUpload) => void;
  isRemoving: boolean;
}

/** Upload button + the state of recent uploads. */
export function SyllabusUploadCard({
  uploads,
  isUploading,
  onPick,
  onRetry,
  canRetry,
  warnings,
  onDismissWarnings,
  onRemove,
  isRemoving,
}: SyllabusUploadCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">İzlence yükle</AppText>
      <AppText variant="caption" tone="muted">
        Dersin PDF izlencesini seç. Haftalık konular ve sınav tarihleri otomatik çıkarılır.
      </AppText>

      <Button
        label={isUploading ? 'İşleniyor…' : 'PDF seç'}
        loading={isUploading}
        onPress={onPick}
      />

      {canRetry ? (
        <Button label="Aynı dosyayı tekrar dene" variant="secondary" disabled={isUploading} onPress={onRetry} />
      ) : null}

      {warnings.length > 0 ? (
        <View style={styles.warnings}>
          <View style={styles.warningHeader}>
            <AppText variant="caption" tone="warning" style={styles.rowText}>
              Son yüklemeden notlar
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notları kapat"
              hitSlop={10}
              onPress={onDismissWarnings}
              style={({ pressed }) => (pressed ? styles.pressed : undefined)}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          {warnings.map((warning) => (
            <AppText key={warning} variant="caption" tone="warning">
              • {warning}
            </AppText>
          ))}
        </View>
      ) : null}

      {uploads.map((upload) => (
        <View key={upload.id} style={styles.row}>
          {isUploadPending(upload) ? <ActivityIndicator size="small" /> : null}
          <View style={styles.rowText}>
            <AppText variant="caption" numberOfLines={1}>
              {upload.filename}
            </AppText>
            <AppText
              variant="caption"
              tone={upload.status === 'failed' ? 'danger' : upload.status === 'succeeded' ? 'success' : 'muted'}
            >
              {STATUS_LABEL[upload.status]}
              {upload.errorMessage ? ` — ${upload.errorMessage}` : ''}
            </AppText>
          </View>
          {isUploadPending(upload) ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${upload.filename} kaydını kaldır`}
              hitSlop={10}
              disabled={isRemoving}
              onPress={() => onRemove(upload)}
              style={({ pressed }) => (pressed || isRemoving ? styles.pressed : undefined)}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      ))}
    </Card>
  );
}

const STATUS_LABEL = {
  pending: 'sırada',
  processing: 'okunuyor…',
  succeeded: 'eklendi',
  failed: 'başarısız',
} as const;

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  card: { gap: spacing.sm },
  warnings: { backgroundColor: colors.warningMuted, borderRadius: radii.sm, padding: spacing.sm, gap: spacing.xxs },
  warningHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { flex: 1 },
  pressed: { opacity: 0.5 },
}));
