import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, makeStyles } from '@shared/ui';
import { Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AttachmentsController } from '../model/useAttachments';

/**
 * A photo of the board or a page, full screen. iOS pinches to zoom in place;
 * Android hands it to the phone's own viewer for that.
 */
export function ImageViewer({ controller }: { controller: AttachmentsController['viewer'] }) {
  const styles = useStyles();
  const vm = controller;
  return (
    <Modal visible={vm.visible} animationType="fade" onRequestClose={vm.onDismiss} statusBarTranslucent>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Kapat" hitSlop={10} onPress={vm.onDismiss}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          <AppText variant="label" style={styles.title} numberOfLines={1}>
            {vm.title}
          </AppText>
          {vm.canOpenElsewhere ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Galeride aç"
              hitSlop={10}
              onPress={vm.onOpenElsewhere}
            >
              <Ionicons name="expand-outline" size={22} color="#FFFFFF" />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Paylaş" hitSlop={10} onPress={vm.onShare}>
            <Ionicons name="share-outline" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.flexGrow}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          {vm.uri ? (
            <Image
              source={{ uri: vm.uri }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={vm.title}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  // The picture decides the colours here; the theme does not.
  screen: { flex: 1, backgroundColor: '#000000' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.md },
  title: { flex: 1, color: '#FFFFFF' },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  image: { flex: 1, width: '100%', minHeight: 300 },
}));
