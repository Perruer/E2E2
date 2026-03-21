/**
 * XAMTON ChatListItem
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, isToday } from 'date-fns';
import { Chat } from '../../core/crypto/types';
import { Avatar } from '../common/Avatar';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';

interface ChatListItemProps {
  chat: Chat;
  contactName: string;
  onPress: () => void;
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  return format(d, 'dd.MM');
}

export function ChatListItem({ chat, contactName, onPress }: ChatListItemProps) {
  const lastText = chat.lastMessage?.content?.text || '';
  const time = formatTime(chat.lastMessageAt);

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      <Avatar name={contactName} size="medium" />

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>{contactName}</Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={styles.preview} numberOfLines={1}>
            {lastText || 'Начните переписку'}
          </Text>
          {chat.unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.light.background,
  },
  content: {
    flex: 1,
    marginLeft: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  name: {
    ...typography.chatName,
    color: colors.light.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  time: {
    ...typography.caption,
    color: colors.light.textSecondary,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  preview: {
    ...typography.chatPreview,
    color: colors.light.textSecondary,
    flex: 1,
    marginRight: spacing.sm,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    ...typography.caption,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
