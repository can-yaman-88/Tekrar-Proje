import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, makeStyles, useTheme } from '@shared/ui';
import { memo } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { describeAttachment, isImage, isPdf, siteName, type Attachment } from '../domain/attachment';

export interface AttachmentRowProps {
  attachment: Attachment;
  /** A picture to show in place of the icon: a local copy or a signed address. */
  previewUri?: string | null;
  /** Shows where it came from: "· Hafta 3 problemleri". */
  showTask?: boolean;
  busy?: boolean;
  onOpen: (attachment: Attachment) => void;
  onMore?: (attachment: Attachment) => void;
}

function iconOf(attachment: Attachment): keyof typeof Ionicons.glyphMap {
  if (attachment.kind === 'link') {
    return attachment.url && siteName(attachment.url) === 'YouTube' ? 'logo-youtube' : 'link-outline';
  }
  return isPdf(attachment) ? 'document-text-outline' : 'image-outline';
}

export const AttachmentRow = memo(function AttachmentRow({
  attachment,
  previewUri = null,
  showTask = false,
  busy = false,
  onOpen,
  onMore,
}: AttachmentRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const meta = [describeAttachment(attachment)];
  if (showTask && attachment.taskTitle) meta.push(attachment.taskTitle);
  if (attachment.isPending) meta.push('gönderilmeyi bekliyor');

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole={attachment.kind === 'link' ? 'link' : 'button'}
        accessibilityLabel={`${attachment.title}, ${meta.join(', ')}`}
        accessibilityHint="Açar"
        onPress={() => onOpen(attachment)}
        disabled={busy}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        {isImage(attachment) && previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={styles.thumb}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.icon, attachment.kind === 'link' && styles.iconLink]}>
            <Ionicons name={iconOf(attachment)} size={20} color={colors.primary} />
          </View>
        )}
        <View style={styles.text}>
          <AppText variant="label" numberOfLines={2}>
            {attachment.title}
          </AppText>
          <AppText variant="caption" tone={attachment.isPending ? 'warning' : 'muted'} numberOfLines={1}>
            {meta.join(' · ')}
          </AppText>
        </View>
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </Pressable>
      {onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${attachment.title} için seçenekler`}
          hitSlop={10}
          onPress={() => onMore(attachment)}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  pressed: { opacity: 0.7 },
  thumb: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryMuted,
  },
  iconLink: { backgroundColor: colors.surfaceMuted },
  text: { flex: 1, gap: spacing.xxs },
  more: { padding: spacing.sm },
}));
