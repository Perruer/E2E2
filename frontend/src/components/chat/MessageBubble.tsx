/**
 * XAMTON MessageBubble
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Message } from '../../core/crypto/types';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import { format } from 'date-fns';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
}

function StatusIcon({ status }: { status: Message['status'] }) {
  if (status === 'sending') {
    return <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.6)" />;
  }
  if (status === 'failed') {
    return <Ionicons name="alert-circle-outline" size={12} color="#FF3B30" />;
  }
  if (status === 'delivered' || status === 'read') {
    return <Ionicons name="checkmark-done" size={12} color={status === 'read' ? '#4FC3F7' : 'rgba(255,255,255,0.8)'} />;
  }
  return <Ionicons name="checkmark" size={12} color="rgba(255,255,255,0.8)" />;
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const text = message.content?.text || '';
  const timeStr = format(new Date(message.timestamp), 'HH:mm');

  return (
    <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
      <View
        style={[
          styles.bubble,
          isOwn ? styles.bubbleOwn : styles.bubbleOther,
        ]}
      >
        <Text style={isOwn ? styles.textOwn : styles.textOther}>{text}</Text>
        <View style={styles.meta}>
          <Text style={[styles.time, isOwn ? styles.timeOwn : styles.timeOther]}>
            {timeStr}
          </Text>
          {isOwn && <StatusIcon status={message.status} />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  rowOwn: {
    justifyContent: 'flex-end',
  },
  rowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: spacing.borderRadiusMd,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 6,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  bubbleOwn: {
    backgroundColor: colors.light.bubbleOwn,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.light.bubbleOther,
    borderBottomLeftRadius: 4,
  },
  textOwn: {
    ...typography.body,
    color: colors.light.bubbleOwnText,
  },
  textOther: {
    ...typography.body,
    color: colors.light.bubbleOtherText,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  time: {
    ...typography.timestamp,
  },
  timeOwn: {
    color: 'rgba(255,255,255,0.7)',
  },
  timeOther: {
    color: colors.light.textTertiary,
  },
});
