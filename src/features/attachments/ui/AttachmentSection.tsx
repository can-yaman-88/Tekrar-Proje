import Ionicons from '@expo/vector-icons/Ionicons';
import { AttachmentRow } from '@entities/attachment';
import { AppText, Button, Card, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useAttachments } from '../model/useAttachments';
import { ActionsSheet } from './ActionsSheet';
import { ImageViewer } from './ImageViewer';
import { LinkSheet } from './LinkSheet';
import { RenameSheet } from './RenameSheet';

export interface AttachmentSectionProps {
  topicId: string;
  /** On a task's screen; null on the topic's own. */
  taskId?: string | null;
  title?: string;
}

/**
 * "Ekler": the PDFs, photos and links that go with a task — and, since they
 * are about what is being learned, with every other task of its topic.
 */
export function AttachmentSection({ topicId, taskId = null, title = 'Ekler' }: AttachmentSectionProps) {
  const target = useMemo(() => ({ topicId, taskId }), [topicId, taskId]);
  const vm = useAttachments(target);
  const styles = useStyles();
  const { colors } = useTheme();

  const actions = [
    { key: 'pdf', icon: 'document-attach-outline', label: 'PDF', onPress: vm.addPdf },
    { key: 'photos', icon: 'images-outline', label: 'Galeri', onPress: vm.addPhotos },
    { key: 'camera', icon: 'camera-outline', label: 'Kamera', onPress: vm.takePhoto },
    { key: 'link', icon: 'link-outline', label: 'Link', onPress: vm.openLink },
  ] as const;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <AppText variant="subtitle" accessibilityRole="header">
          {title}
        </AppText>
        {vm.count > 0 ? (
          <AppText variant="caption" tone="muted">
            {vm.count}
          </AppText>
        ) : null}
        {vm.isAdding ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>

      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={`${action.label} ekle`}
            disabled={vm.isAdding}
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, (pressed || vm.isAdding) && styles.actionMuted]}
          >
            <Ionicons name={action.icon} size={18} color={colors.primary} />
            <AppText variant="caption" tone="primary">
              {action.label}
            </AppText>
          </Pressable>
        ))}
      </View>

      {vm.isLoading ? (
        <Skeleton height={60} radius={12} />
      ) : vm.isOffline && vm.sections.length === 0 ? (
        <Card>
          <AppText variant="caption" tone="muted">
            Çevrimdışısın; ekler bağlanınca görünür. Yine de ekleyebilirsin, bağlantı gelince yüklenir.
          </AppText>
        </Card>
      ) : vm.error ? (
        <Card style={styles.card}>
          <AppText variant="caption" tone="danger">
            {vm.error}
          </AppText>
          <Button label="Tekrar dene" variant="ghost" onPress={vm.retry} />
        </Card>
      ) : vm.sections.length === 0 ? (
        <Card>
          <AppText variant="caption" tone="muted">
            {vm.onTaskScreen
              ? 'Ders notunun PDF’i, tahtanın fotoğrafı ya da konu anlatım videosu: buraya eklediğin her şey bu konunun sonraki tekrarlarında da karşına çıkar.'
              : 'Bu konuya ya da görevlerine eklenen PDF, fotoğraf ve linkler burada toplanır.'}
          </AppText>
        </Card>
      ) : (
        vm.sections.map((section) => (
          <Card key={section.key} style={styles.card}>
            {section.title ? (
              <AppText variant="caption" tone="muted">
                {section.title}
              </AppText>
            ) : null}
            {section.items.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                previewUri={vm.previewOf(attachment)}
                showTask={vm.showsTaskOf(attachment)}
                busy={vm.busyId === attachment.id}
                onOpen={vm.onOpen}
                onMore={vm.onMore}
              />
            ))}
          </Card>
        ))
      )}

      <LinkSheet controller={vm.link} />
      <RenameSheet controller={vm.rename} />
      <ActionsSheet controller={vm.actions} />
      <ImageViewer controller={vm.viewer} />
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  container: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  card: { gap: spacing.xs },
}));
