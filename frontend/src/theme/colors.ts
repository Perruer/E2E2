/**
 * XAMTON Theme Colors
 */

const palette = {
  blue: '#2AABEE',
  blueDark: '#1A8EC8',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#5856D6',

  grey100: '#F2F2F7',
  grey200: '#E5E5EA',
  grey300: '#D1D1D6',
  grey400: '#AEAEB2',
  grey500: '#8E8E93',
  grey600: '#636366',
  grey700: '#3A3A3C',
  grey800: '#2C2C2E',
  grey900: '#1C1C1E',
};

export const colors = {
  light: {
    primary: palette.blue,
    primaryDark: palette.blueDark,
    success: palette.green,
    warning: palette.orange,
    danger: palette.red,

    background: '#FFFFFF',
    chatListBackground: '#F2F2F7',
    chatBackground: '#E8EFF5',
    header: '#FFFFFF',
    headerText: '#000000',
    inputBackground: '#F2F2F7',

    textPrimary: '#000000',
    textSecondary: palette.grey500,
    textTertiary: palette.grey400,
    inputPlaceholder: palette.grey400,

    separator: palette.grey200,
    border: palette.grey300,

    bubbleOwn: palette.blue,
    bubbleOwnText: '#FFFFFF',
    bubbleOther: '#FFFFFF',
    bubbleOtherText: '#000000',

    transportInternet: palette.blue,
    transportDNS: palette.purple,
    transportMesh: palette.green,

    error: palette.red,

    statusBar: 'dark' as const,
  },
  dark: {
    primary: palette.blue,
    primaryDark: palette.blueDark,
    success: palette.green,
    warning: palette.orange,
    danger: palette.red,

    background: palette.grey900,
    chatListBackground: palette.grey900,
    chatBackground: '#17212B',
    header: palette.grey800,
    headerText: '#FFFFFF',
    inputBackground: palette.grey800,

    textPrimary: '#FFFFFF',
    textSecondary: palette.grey400,
    textTertiary: palette.grey600,
    inputPlaceholder: palette.grey500,

    separator: palette.grey700,
    border: palette.grey700,

    bubbleOwn: '#2B5278',
    bubbleOwnText: '#FFFFFF',
    bubbleOther: palette.grey800,
    bubbleOtherText: '#FFFFFF',

    transportInternet: palette.blue,
    transportDNS: palette.purple,
    transportMesh: palette.green,

    error: palette.red,

    statusBar: 'light' as const,
  },
};

export type ThemeColors = typeof colors.light;
