/**
 * XAMTON New Chat Screen
 */

import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContactStore } from '../src/store/useContactStore';
import { useChatStore } from '../src/store/useChatStore';
import { useIdentityStore } from '../src/store/useIdentityStore';
import { Avatar } from '../src/components/common/Avatar';
import { colors } from '../src/theme/colors';
import { typography } from '../src/theme/typography';
import { spacing } from '../src/theme/spacing';
import { Contact } from '../src/core/crypto/types';
import { encodeBase64 } from 'tweetnacl-util';

export default function NewChatScreen() {
  const router = useRouter();
  const { contacts } = useContactStore();
  const { createChat, getChatByParticipant } = useChatStore();
  const { identity, displayName } = useIdentityStore();

  const handleContactPress = async (contact: Contact) => {
    if (!identity) return;
    
    let chat = getChatByParticipant(contact.userId);
    
    if (!chat) {
      chat = await createChat([identity.userId, contact.userId], contact.name);
    }
    
    router.replace(`/chat/${chat.id}`);
  };

  const handleScanQR = () => {
    router.push('/qrscan');
  };

  const handleShareInvite = async () => {
    if (!identity) return;
    const name = encodeURIComponent(displayName || 'User');
    const key = encodeBase64(identity.identityKeyPair.publicKey);
    const link = `xamton://invite?u=${identity.userId}&k=${encodeURIComponent(key)}&n=${name}`;
    try {
      await Share.share({
        message: `Добавь меня в XAMTON: ${link}`,
        title: 'XAMTON — приглашение',
      });
    } catch {}
  };

  return (
    <View style={styles.container}>
      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionItem} onPress={handleScanQR}>
          <View style={[styles.actionIcon, { backgroundColor: colors.light.primary }]}>
            <Ionicons name="qr-code" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.actionText}>Добавить по QR-коду</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionItem} onPress={handleShareInvite}>
          <View style={[styles.actionIcon, { backgroundColor: '#FF9500' }]}>
            <Ionicons name="link" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.actionText}>Пригласить по ссылке</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionItem}>
          <View style={[styles.actionIcon, { backgroundColor: colors.light.success }]}>
            <Ionicons name="people" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.actionText}>Создать группу</Text>
        </TouchableOpacity>
      </View>

      {/* Contacts */}
      {contacts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Контакты</Text>
          <FlatList
            data={contacts}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.contactItem}
                onPress={() => handleContactPress(item)}
              >
                <Avatar name={item.name} size="medium" verified={item.verified} />
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{item.name}</Text>
                  <Text style={styles.contactId} numberOfLines={1}>
                    {item.userId}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>
      )}

      {contacts.length === 0 && (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={64} color={colors.light.textTertiary} />
          <Text style={styles.emptyTitle}>Нет контактов</Text>
          <Text style={styles.emptyText}>
            Добавьте контакт по QR-коду{"\n"}
            или отправьте пригласительную ссылку
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.inputBackground,
  },
  actions: {
    backgroundColor: colors.light.background,
    marginBottom: spacing.lg,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.separator,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: {
    ...typography.body,
    color: colors.light.textPrimary,
    marginLeft: spacing.md,
  },
  section: {
    backgroundColor: colors.light.background,
    flex: 1,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.light.textSecondary,
    textTransform: 'uppercase',
    marginLeft: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
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
});
