/**
 * XAMTON Theme Index
 * Экспорт всей системы дизайна
 */

export * from './colors';
export * from './typography';
export * from './spacing';

import { colors, ThemeName, ThemeColors } from './colors';
import { typography } from './typography';
import { spacing } from './spacing';

export interface Theme {
  colors: ThemeColors;
  typography: typeof typography;
  spacing: typeof spacing;
  isDark: boolean;
}

export function createTheme(themeName: ThemeName): Theme {
  return {
    colors: colors[themeName],
    typography,
    spacing,
    isDark: themeName === 'dark',
  };
}

export const lightTheme = createTheme('light');
export const darkTheme = createTheme('dark');
