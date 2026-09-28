import { Skeleton } from '@shared/ui';
import { View } from 'react-native';
import { useTaskCardStyles } from './TaskCard.styles';

export function TaskCardSkeleton() {
  const styles = useTaskCardStyles();
  return (
    <View style={styles.card}>
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <Skeleton width="45%" height={12} />
            <Skeleton width="80%" height={18} />
          </View>
          <Skeleton width={28} height={28} radius={14} />
        </View>
        <View style={styles.metaRow}>
          <Skeleton width={72} height={18} radius={9} />
          <Skeleton width={96} height={18} radius={9} />
        </View>
        <Skeleton height={6} radius={3} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}
