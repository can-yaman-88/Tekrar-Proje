import { ExamChipSkeleton } from '@entities/exam';
import { TaskCardSkeleton } from '@entities/task';
import { Skeleton } from '@shared/ui';
import { View } from 'react-native';
import { useMissionStyles } from './MissionScreen.styles';

/** Mirrors the real layout so content doesn't jump when data arrives. */
export function MissionScreenSkeleton() {
  const styles = useMissionStyles();
  return (
    <View style={styles.skeletonContent} accessibilityLabel="Loading missions" accessibilityRole="progressbar">
      <View style={styles.skeletonHeader}>
        <Skeleton width={140} height={12} />
        <Skeleton width="70%" height={30} />
        <Skeleton height={8} radius={4} />
        <Skeleton height={44} radius={10} />
      </View>
      <View style={styles.skeletonExams}>
        <ExamChipSkeleton />
        <ExamChipSkeleton />
      </View>
      {[0, 1, 2, 3].map((i) => (
        <TaskCardSkeleton key={i} />
      ))}
    </View>
  );
}
