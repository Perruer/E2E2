/**
 * XAMTON DateSeparator
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { format, isToday, isYesterday } from 'date-fns';
import { ru } from 'date-fns/locale';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';

interface DateSeparatorProps {
  date: Date;
}

function formatDate(date: Date): string {
  if (isToday(date)) return 'Сегодня';
  if (isYesterday(date)) return 'Вчера';
  return format(date, 'd MMMM yyyy', { locale: ru });
}

export function DateSeparator({ date }: DateSeparatorProps) {
  return (
    <View style={styles.container}>
      <View style={styles.line} />
      <View style={styles.badge}>
        <Text style={styles.text}>{formatDate(date)}</Text>
      </View>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.light.separator,
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.06)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: spacing.borderRadiusFull,
    marginHorizontal: spacing.sm,
  },
  text: {
    ...typography.caption,
    color: colors.light.textSecondary,
  },
});
