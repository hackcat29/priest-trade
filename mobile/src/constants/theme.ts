import { Platform } from 'react-native';

export const PriestTheme = {
  colors: {
    // Brand Accents
    primary: '#00FF94',
    primaryGlow: 'rgba(0, 255, 148, 0.25)',
    primaryDim: 'rgba(0, 255, 148, 0.12)',
    primaryDark: '#00CC76',

    danger: '#EF4444',
    dangerDim: 'rgba(239, 68, 68, 0.12)',
    dangerGlow: 'rgba(239, 68, 68, 0.25)',

    warning: '#F59E0B',
    warningDim: 'rgba(245, 158, 11, 0.12)',

    info: '#38BDF8',
    infoDim: 'rgba(56, 189, 248, 0.12)',

    purple: '#836EF9',
    purpleDim: 'rgba(131, 110, 249, 0.15)',

    // Dark Obsidian Surfaces
    bg0: '#0A0A0C', // Root background
    bg1: '#101115', // Header / Topbar / Navigation
    bg2: '#16171E', // Card backgrounds
    bg3: '#1D1F28', // Input / Elevated controls
    bg4: '#262835', // Highlighted / Selected state

    // Borders
    border: '#22242E',
    borderSubtle: '#181922',
    borderHighlight: '#2A2C38',
    borderFocus: '#00FF94',

    // Text & Labels
    textPrimary: '#F2F3F5',
    textSecondary: '#91939C',
    textMuted: '#585A65',
    textDisabled: '#383944',

    // Trading Terminal specifics
    long: '#00FF94',
    short: '#EF4444',
    bid: 'rgba(0, 255, 148, 0.15)',
    ask: 'rgba(239, 68, 68, 0.15)',
  },
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    tabBarInset: Platform.select({ ios: 88, android: 72 }) ?? 80,
  },
} as const;

export const Colors = {
  light: {
    text: PriestTheme.colors.textPrimary,
    background: PriestTheme.colors.bg0,
    backgroundElement: PriestTheme.colors.bg2,
    backgroundSelected: PriestTheme.colors.bg3,
    textSecondary: PriestTheme.colors.textSecondary,
  },
  dark: {
    text: PriestTheme.colors.textPrimary,
    background: PriestTheme.colors.bg0,
    backgroundElement: PriestTheme.colors.bg2,
    backgroundSelected: PriestTheme.colors.bg3,
    textSecondary: PriestTheme.colors.textSecondary,
  },
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'System',
    mono: 'Courier',
  },
  android: {
    sans: 'Roboto',
    mono: 'monospace',
  },
  default: {
    sans: 'normal',
    mono: 'monospace',
  },
});
