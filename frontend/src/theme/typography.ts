/**
 * XAMTON Typography
 */
import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: { regular: 'System', medium: 'System', bold: 'System' },
  default: { regular: 'sans-serif', medium: 'sans-serif-medium', bold: 'sans-serif' },
});

export const typography = {
  h1: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 40,
    fontFamily: fontFamily.bold,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600' as const,
    lineHeight: 30,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    lineHeight: 22,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 20,
  },
  chatPreview: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 18,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 22,
  },
  buttonSmall: {
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 18,
  },
  timestamp: {
    fontSize: 11,
    fontWeight: '400' as const,
    lineHeight: 14,
  },
};
