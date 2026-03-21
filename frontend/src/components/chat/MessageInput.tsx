/**
 * XAMTON MessageInput
 */
import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';

interface MessageInputProps {
  onSend: (text: string) => void;
  onAttach?: () => void;
  onVoice?: () => void;
  placeholder?: string;
}

export function MessageInput({ onSend, onAttach, onVoice, placeholder = 'Сообщение...' }: MessageInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const hasText = text.trim().length > 0;

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        {/* Attach */}
        <TouchableOpacity style={styles.iconButton} onPress={onAttach}>
          <Ionicons name="attach" size={24} color={colors.light.textSecondary} />
        </TouchableOpacity>

        {/* Text field */}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.light.inputPlaceholder}
          multiline
          maxLength={4000}
          returnKeyType="default"
        />

        {/* Send or voice */}
        {hasText ? (
          <TouchableOpacity style={styles.sendButton} onPress={handleSend} activeOpacity={0.8}>
            <Ionicons name="send" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.iconButton} onPress={onVoice}>
            <Ionicons name="mic-outline" size={24} color={colors.light.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.light.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.light.separator,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.md : spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.light.inputBackground,
    borderRadius: spacing.borderRadiusFull,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    minHeight: 44,
  },
  iconButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.light.textPrimary,
    maxHeight: 120,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
