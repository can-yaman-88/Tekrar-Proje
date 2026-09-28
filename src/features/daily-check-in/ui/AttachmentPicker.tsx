import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, makeStyles, useTheme } from '@shared/ui';
import { Pressable, ScrollView, View } from 'react-native';
import type { AttachmentsController } from '../model/useCheckinAttachments';

const formatSize = (bytes: number): string =>
  bytes <= 0 ? '' : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function AttachmentPicker({ attachments, disabled }: { attachments: AttachmentsController; disabled: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();

  const actions = [
    { icon: 'document-attach-outline', label: 'PDF', onPress: attachments.pickPdf },
    { icon: 'image-outline', label: 'Galeri', onPress: attachments.pickFromLibrary },
    { icon: 'camera-outline', label: 'Kamera', onPress: attachments.pickFromCamera },
  ] as const;

  return (
    <View style={styles.container}>
      <AppText variant="caption" tone="muted">
        {"Ödev PDF'i veya soru fotoğrafı ekleyebilirsin; içindeki işler görev olarak eklenir."}
      </AppText>

      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={`${action.label} ekle`}
            disabled={disabled}
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, (pressed || disabled) && styles.actionMuted]}
          >
            <Ionicons name={action.icon} size={18} color={colors.primary} />
            <AppText variant="caption" tone="primary">
              {action.label}
            </AppText>
          </Pressable>
        ))}
      </View>

      {attachments.files.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {attachments.files.map((file) => (
            <View key={file.uri} style={styles.chip}>
              <Ionicons
                name={file.mimeType === 'application/pdf' ? 'document-text-outline' : 'image-outline'}
                size={14}
                color={colors.textMuted}
              />
              <AppText variant="caption" numberOfLines={1} style={styles.chipLabel}>
                {file.filename}
              </AppText>
              {formatSize(file.sizeBytes) ? (
                <AppText variant="caption" tone="muted">
                  {formatSize(file.sizeBytes)}
                </AppText>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${file.filename} dosyasını kaldır`}
                hitSlop={8}
                disabled={disabled}
                onPress={() => attachments.remove(file.uri)}
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  container: { gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.primaryMuted,
  },
  actionMuted: { opacity: 0.6 },
  chips: { gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 240,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  chipLabel: { flexShrink: 1 },
}));
