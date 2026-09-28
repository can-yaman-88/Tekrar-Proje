import type { TextStyle } from 'react-native';

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  skeleton: string;
}

export const lightColors: ColorTokens = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F3',
  border: '#E1E4E8',
  text: '#14171C',
  textMuted: '#5F6773',
  textInverse: '#FFFFFF',
  primary: '#3451D1',
  primaryMuted: '#E6EBFC',
  success: '#1E8E4E',
  successMuted: '#E3F4EA',
  warning: '#B26B00',
  warningMuted: '#FBF0DC',
  danger: '#C8372D',
  dangerMuted: '#FBE7E5',
  skeleton: '#E4E7EB',
};

export const darkColors: ColorTokens = {
  background: '#0E1116',
  surface: '#161A21',
  surfaceMuted: '#1F242D',
  border: '#2A303B',
  text: '#ECEFF3',
  textMuted: '#9AA3AF',
  textInverse: '#0E1116',
  primary: '#7F98FF',
  primaryMuted: '#1E2748',
  success: '#4CC784',
  successMuted: '#14301F',
  warning: '#F0AE45',
  warningMuted: '#352812',
  danger: '#FF7A6E',
  dangerMuted: '#3A1A18',
  skeleton: '#232933',
};

/** Fallback course accents when a course has no colour set (picked by id hash). */
export const accentPalette = ['#3451D1', '#0F8B8D', '#C0582F', '#7B4FD6', '#2E8B3E', '#B8367A'] as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  subtitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
}

export const lightTheme: Theme = { scheme: 'light', colors: lightColors, spacing, radii, typography };
export const darkTheme: Theme = { scheme: 'dark', colors: darkColors, spacing, radii, typography };
