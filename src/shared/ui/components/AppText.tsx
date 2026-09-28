import { Text, type TextProps } from 'react-native';
import { useTheme, type ColorTokens, type TypographyVariant } from '../theme';

export type TextTone = 'default' | 'muted' | 'inverse' | 'primary' | 'success' | 'warning' | 'danger';

const TONE: Record<TextTone, keyof ColorTokens> = {
  default: 'text',
  muted: 'textMuted',
  inverse: 'textInverse',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
}

export function AppText({ variant = 'body', tone = 'default', style, ...rest }: AppTextProps) {
  const theme = useTheme();
  return <Text {...rest} style={[theme.typography[variant], { color: theme.colors[TONE[tone]] }, style]} />;
}
