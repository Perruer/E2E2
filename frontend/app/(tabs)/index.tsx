/**
 * XAMTON Chat List Screen
 * Главный экран со списком чатов
 */

import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useChatStore } from '../../src/store/useChatStore';
import { useContactStore } from '../../src/store/useContactStore';
import { useIdentityStore } from '../../src/store/useIdentityStore';
import { ChatListItem } from '../../src/components/chatlist/ChatListItem';
import { TransportStatusBar } from '../../src/components/network/TransportStatusBar';
import { FloatingActionButton } from '../../src/components/common/FloatingActionButton';
import { colors } from '../../src/theme/colors';
import { typography } from '../../src/theme/typography';
import { spacing } from '../../src/theme/spacing';
import { Chat } from '../../src/core/crypto/types';
import { requestAllPermissions } from '../../src/core/network/Permissions';
import { messagePipeline } from '../../src/core/network/MessagePipeline';

export default function ChatListScreen() {
  const router = useRouter();
  const { chats } = useChatStore();
  const { contacts } = useContactStore();
  const { displayName, identity } = useIdentityStore();

  // Запрашиваем разрешения при первом открытии главного экрана
  useEffect(() => {
    async function requestPerms() {
      const result = await requestAllPermissions();
      console.log('[Index] Permissions:', result);

      if (!result.bluetooth) {
        Alert.alert(
          'Bluetooth недоступен',
          'Для работы mesh-сети без интернета нужен Bluetooth. Разрешить?',
          [
            { text: 'Потом', style: 'cancel' },
            { text: 'Настройки', onPress: () => Linking.openSettings() },
          ]
        );
      }

      // Перезапускаем транспорты после получения разрешений
      if (identity && (result.bluetooth || result.location)) {
        messagePipeline.initializeTransports().catch(console.warn);
      }
    }

    requestPerms();
  }, [identity]);

  const getContactName = useCallback((chat: Chat) => {
    if (chat.type === 'group') return chat.name || 'Группа';
    const participantId = chat.participantIds.find(id => id !== identity?.userId);
    if (!participantId) return 'Неизвестный';
    const contact = contacts.find(c => c.userId === participantId);
    return contact?.name || participantId.slice(0, 12) + '...';
  }, [contacts, identity?.userId]);

  const handleChatPress = (chat: Chat) => router.push(`/chat/${chat.id}`);
  const handleNewChat = () => router.push('/newchat');
  const handleNetworkPress = () => router.push('/network');

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="chatbubbles-outline" size={64} color={colors.light.textTertiary} />
      <Text style={styles.emptyTitle}>Нет чатов</Text>
      <Text style={styles.emptyText}>
        Нажмите кнопку ниже, чтобы{"\n"}начать новый чат
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuButton}>
          <Ionicons name="menu" size={26} color={colors.light.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>XAMTON</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerButton}>
            <Ionicons name="search" size={24} color={colors.light.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Transport Status */}
      <TransportStatusBar onPress={handleNetworkPress} />

      {/* Chat List */}
      <FlatList
        data={chats}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            contactName={getContactName(item)}
            onPress={() => handleChatPress(item)}
          />
        )}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={chats.length === 0 ? styles.emptyList : undefined}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* FAB */}
      <FloatingActionButton
        icon="create-outline"
        onPress={handleNewChat}
        style={styles.fab}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.chatListBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.light.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.separator,
  },
  menuButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    ...typography.navTitle,
    color: colors.light.primary,
    letterSpacing: 2,
  },
  headerRight: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerButton: {
    padding: spacing.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.light.separator,
    marginLeft: spacing.md + spacing.avatarSize + spacing.md,
  },
  emptyList: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
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
  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.lg,
  },
});