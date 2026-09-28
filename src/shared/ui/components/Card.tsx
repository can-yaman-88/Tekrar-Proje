import { View, type ViewProps } from 'react-native';
import { makeStyles } from '../theme';

export function Card({ style, ...rest }: ViewProps) {
  const styles = useStyles();
  return <View style={[styles.card, style]} {...rest} />;
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
}));
