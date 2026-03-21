/**
 * XAMTON Contacts Screen
 */

import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContactStore } from '../../src/store/useContactStore';
import { useChatStore } from '../../src/store/useChatStore';
import { useIdentityStore } from '../../src/store/useIdentityStore';
import { Avatar } from '../../src/components/common/Avatar';
import { colors } from '../../src/theme/colors';
import { typography } from '../../src/theme/typography';
import { spacing } from '../../src/theme/spacing';
import { Contact } from '../../src/core/crypto/types';

export default function ContactsScreen() {
  const router = useRouter();
  const { contacts, deleteContact } = useContactStore();
  const { createChat, getChatByParticipant } = useChatStore();
  const { identity } = useIdentityStore();

  const handleContactPress = async (contact: Contact) => {
    // Проверяем, есть ли уже чат
    let chat = getChatByParticipant(contact.userId);
    
    if (!chat && identity) {
      chat = await createChat([identity.userId, contact.userId]);
    }
    
    if (chat) {
      router.push(`/chat/${chat.id}`);
    }
  };

  const handleContactLongPress = (contact: Contact) => {
    Alert.alert(
      contact.name,
      'Выберите действие',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => deleteContact(contact.id) },
      ]
    );
  };

  const handleAddContact = () => {
    router.push('/qrscan');
  };

  const renderContact = ({ item }: { item: Contact }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => handleContactPress(item)}
      onLongPress={() => handleContactLongPress(item)}
    >
      <Avatar name={item.name} size="medium" verified={item.verified} />
      <View style={styles.contactInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.contactName}>{item.name}</Text>
          {item.verified && (
            <Ionicons name="shield-checkmark" size={16} color={colors.light.success} />
          )}
        </View>
        <Text style={styles.contactId} numberOfLines={1}>
          {item.userId}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="people-outline" size={64} color={colors.light.textTertiary} />
      <Text style={styles.emptyTitle}>Нет контактов</Text>
      <Text style={styles.emptyText}>
        Добавьте контакт, отсканировав{"\n"}
        QR-код собеседника
      </Text>
      <TouchableOpacity style={styles.addButton} onPress={handleAddContact}>
        <Ionicons name="qr-code-outline" size={20} color="#FFFFFF" />
        <Text style={styles.addButtonText}>Сканировать QR</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={contacts}
        keyExtractor={item => item.id}
        renderItem={renderContact}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={contacts.length === 0 ? styles.emptyList : undefined}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
      
      {contacts.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={handleAddContact}>
          <Ionicons name="person-add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  contactInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  contactName: {
    ...typography.chatName,
    color: colors.light.textPrimary,
  },
  contactId: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginTop: 2,
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
  addButton: {
    flexDirection: 'row',
    backgroundColor: colors.light.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.borderRadiusMd,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  addButtonText: {
    ...typography.button,
    color: '#FFFFFF',
  },
  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.27,
    shadowRadius: 4.65,
  },
});
