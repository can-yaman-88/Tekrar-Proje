import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { makeStyles, useTheme } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface StateViewProps {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'danger';
}

/** Centered empty / error / info state. */
export function StateView({ icon, title, message, actionLabel, onAction, tone = 'default' }: StateViewProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={[styles.iconWrap, tone === 'danger' && styles.iconWrapDanger]}>
        <Ionicons name={icon} size={28} color={tone === 'danger' ? colors.danger : colors.primary} />
      </View>
      <AppText variant="subtitle" style={styles.center}>
        {title}
      </AppText>
      {message ? (
        <AppText tone="muted" style={styles.center}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} style={styles.action} /> : null}
    </View>
  );
}

export function ErrorState(props: Omit<StateViewProps, 'icon' | 'tone'>) {
  return <StateView icon="cloud-offline-outline" tone="danger" {...props} />;
}

export function EmptyState(props: StateViewProps) {
  return <StateView {...props} />;
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  iconWrapDanger: { backgroundColor: colors.dangerMuted },
  center: { textAlign: 'center' },
  action: { marginTop: spacing.md, alignSelf: 'stretch' },
}));
