/**
 * XAMTON Unread Badge
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface UnreadBadgeProps {
  count: number;
  muted?: boolean;
}

export function UnreadBadge({ count, muted = false }: UnreadBadgeProps) {
  if (count <= 0) return null;

  const displayCount = count > 99 ? '99+' : count.toString();
  const isWide = count > 9;

  return (
    <View
      style={[
        styles.badge,
        isWide && styles.wideBadge,
        muted && styles.mutedBadge,
      ]}
    >
      <Text style={[styles.text, muted && styles.mutedText]}>{displayCount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.light.unreadBadge,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  wideBadge: {
    minWidth: 28,
  },
  mutedBadge: {
    backgroundColor: colors.light.textTertiary,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  mutedText: {
    color: '#FFFFFF',
  },
});
