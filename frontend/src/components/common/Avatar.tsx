/**
 * XAMTON Avatar Component
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

type AvatarSize = 'small' | 'medium' | 'large';

interface AvatarProps {
  name: string;
  size?: AvatarSize;
  verified?: boolean;
}

const sizeMap = {
  small: spacing.avatarSizeSm,
  medium: spacing.avatarSize,
  large: spacing.avatarSizeLg,
};

const fontSizeMap = {
  small: 14,
  medium: 18,
  large: 24,
};

// Генерация цвета по имени
function getAvatarColor(name: string): string {
  const avatarColors = [
    '#2AABEE', '#1A8EC8', '#34C759', '#FF9500',
    '#5856D6', '#FF3B30', '#AF52DE', '#00C7BE',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function Avatar({ name, size = 'medium', verified = false }: AvatarProps) {
  const dim = sizeMap[size];
  const fontSize = fontSizeMap[size];
  const bgColor = getAvatarColor(name);
  const initials = getInitials(name);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.avatar, { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: bgColor }]}>
        <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
      </View>
      {verified && (
        <View style={[styles.badge, { bottom: 0, right: 0 }]}>
          <Ionicons name="shield-checkmark" size={size === 'small' ? 10 : 14} color={colors.light.success} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
