/**
 * XAMTON Chat Screen
 * Экран переписки
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useChatStore } from '../../src/store/useChatStore';
import { useContactStore } from '../../src/store/useContactStore';
import { useIdentityStore } from '../../src/store/useIdentityStore';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import { MessageInput } from '../../src/components/chat/MessageInput';
import { DateSeparator } from '../../src/components/chat/DateSeparator';
import { Avatar } from '../../src/components/common/Avatar';
import { colors } from '../../src/theme/colors';
import { typography } from '../../src/theme/typography';
import { spacing } from '../../src/theme/spacing';
import { Message, TransportType } from '../../src/core/crypto/types';
import { messagePipeline } from '../../src/core/network/MessagePipeline';
import { v4 as uuidv4 } from 'uuid';
import { isSameDay } from 'date-fns';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  
  const { getChat, messages, addMessage, markAsRead } = useChatStore();
  const { contacts } = useContactStore();
  const { identity } = useIdentityStore();

  const chat = getChat(id);
  const chatMessages = messages[id] || [];

  // Получаем имя контакта
  const getContactName = useCallback(() => {
    if (!chat) return 'Чат';
    if (chat.type === 'group') return chat.name || 'Группа';
    
    const participantId = chat.participantIds.find(pid => pid !== identity?.userId);
    if (!participantId) return 'Чат';
    
    const contact = contacts.find(c => c.userId === participantId);
    return contact?.name || participantId.slice(0, 12) + '...';
  }, [chat, contacts, identity?.userId]);

  // Получаем userId собеседника
  const getRecipientId = useCallback(() => {
    if (!chat || !identity) return null;
    return chat.participantIds.find(pid => pid !== identity.userId) || null;
  }, [chat, identity]);

  const contactName = getContactName();

  useEffect(() => {
    if (id) {
      markAsRead(id);
    }
  }, [id]);

  const handleSend = async (text: string) => {
    if (!identity || !chat) return;

    const recipientId = getRecipientId();
    
    if (recipientId) {
      // Отправляем через MessagePipeline (шифрование + сеть)
      try {
        await messagePipeline.sendTextMessage(id, recipientId, text);
      } catch (err) {
        console.error('Send error:', err);
        // Fallback: сохраняем локально
        const fallbackMessage: Message = {
          id: uuidv4(),
          chatId: id,
          senderId: identity.userId,
          type: 'text',
          content: { type: 'text', text },
          timestamp: Date.now(),
          status: 'failed',
          transportUsed: 'offline' as TransportType,
        };
        await addMessage(id, fallbackMessage);
      }
    } else {
      // Нет получателя — сохраняем локально
      const localMessage: Message = {
        id: uuidv4(),
        chatId: id,
        senderId: identity.userId,
        type: 'text',
        content: { type: 'text', text },
        timestamp: Date.now(),
        status: 'sent',
        transportUsed: 'offline' as TransportType,
      };
      await addMessage(id, localMessage);
    }
    
    // Прокрутка вниз
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Группировка сообщений по датам
  const messagesWithDates = chatMessages.reduce<(Message | { type: 'date'; date: Date })[]>(
    (acc, message, index) => {
      const messageDate = new Date(message.timestamp);
      const prevMessage = chatMessages[index - 1];
      
      if (!prevMessage || !isSameDay(messageDate, new Date(prevMessage.timestamp))) {
        acc.push({ type: 'date', date: messageDate });
      }
      acc.push(message);
      return acc;
    },
    []
  );

  const renderItem = ({ item }: { item: Message | { type: 'date'; date: Date } }) => {
    if ('type' in item && item.type === 'date') {
      return <DateSeparator date={item.date} />;
    }
    
    const message = item as Message;
    const isOwn = message.senderId === identity?.userId;
    return <MessageBubble message={message} isOwn={isOwn} />;
  };

  if (!chat) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>Чат не найден</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <TouchableOpacity style={styles.headerTitle}>
              <Avatar name={contactName} size="small" />
              <View style={styles.headerInfo}>
                <Text style={styles.headerName}>{contactName}</Text>
                <Text style={styles.headerStatus}>оффлайн</Text>
              </View>
            </TouchableOpacity>
          ),
          headerRight: () => (
            <View style={styles.headerRight}>
              <TouchableOpacity style={styles.headerButton}>
                <Ionicons name="lock-closed" size={18} color={colors.light.success} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton}>
                <Ionicons name="ellipsis-vertical" size={22} color={colors.light.textPrimary} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.messagesContainer}>
          <FlatList
            ref={flatListRef}
            data={messagesWithDates}
            keyExtractor={(item, index) => {
              if ('type' in item && item.type === 'date') {
                return `date-${index}`;
              }
              return (item as Message).id;
            }}
            renderItem={renderItem}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={() => {
              flatListRef.current?.scrollToEnd({ animated: false });
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="lock-closed" size={48} color={colors.light.textTertiary} />
                <Text style={styles.emptyTitle}>E2E шифрование</Text>
                <Text style={styles.emptyText}>
                  Сообщения в этом чате{"\n"}
                  защищены сквозным шифрованием
                </Text>
              </View>
            }
          />
        </View>
        
        <MessageInput
          onSend={handleSend}
          onAttach={() => {}}
          onVoice={() => {}}
        />
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.chatBackground,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerInfo: {
    marginLeft: spacing.sm,
  },
  headerName: {
    ...typography.navTitle,
    color: colors.light.textPrimary,
  },
  headerStatus: {
    ...typography.caption,
    color: colors.light.textSecondary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: spacing.sm,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesList: {
    paddingVertical: spacing.sm,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notFoundText: {
    ...typography.body,
    color: colors.light.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.light.textPrimary,
    marginTop: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
