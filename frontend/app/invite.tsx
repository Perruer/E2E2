/**
 * XAMTON Invite Screen
 * Обрабатывает пригласительные ссылки и добавляет контакт
 * 
 * Deep link формат: xamton://invite?u=USER_ID&k=IDENTITY_KEY_B64&n=NAME
 * Share формат: https://xamton.app/invite?u=USER_ID&k=IDENTITY_KEY_B64&n=NAME
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContactStore } from '../src/store/useContactStore';
import { useIdentityStore } from '../src/store/useIdentityStore';
import { useChatStore } from '../src/store/useChatStore';
import { Avatar } from '../src/components/common/Avatar';
import { colors } from '../src/theme/colors';
import { typography } from '../src/theme/typography';
import { spacing } from '../src/theme/spacing';
import { decodeBase64 } from 'tweetnacl-util';

export default function InviteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ u?: string; k?: string; n?: string }>();
  const { addContact, getContact } = useContactStore();
  const { identity } = useIdentityStore();
  const { createChat, getChatByParticipant } = useChatStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = params.u;
  const keyB64 = params.k;
  const name = params.n ? decodeURIComponent(params.n) : 'Unknown';

  useEffect(() => {
    if (!userId || !keyB64) {
      setError('Некорректная ссылка приглашения');
    }
    if (userId === identity?.userId) {
      setError('Это ваша собственная ссылка');
    }
  }, [userId, keyB64, identity]);

  const handleAddContact = async () => {
    if (!userId || !keyB64 || !identity) return;
    
    setLoading(true);
    try {
      const identityKey = decodeBase64(keyB64);
      const contact = await addContact(userId, name, identityKey, false);
      
      // Создаём чат сразу
      let chat = getChatByParticipant(userId);
      if (!chat) {
        chat = await createChat([identity.userId, userId], name);
      }
      
      Alert.alert('Готово', `${name} добавлен в контакты`, [
        { text: 'Написать', onPress: () => router.replace(`/chat/${chat!.id}`) },
        { text: 'OK', onPress: () => router.replace('/(tabs)') },
      ]);
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось добавить контакт');
    } finally {
      setLoading(false);
    }
  };

  const alreadyAdded = userId ? !!getContact(userId) : false;

  if (error) {
    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle" size={64} color={colors.light.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Назад</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Avatar name={name} size="large" />
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.userId}>{userId?.slice(0, 24)}...</Text>
      
      {alreadyAdded ? (
        <>
          <View style={styles.badge}>
            <Ionicons name="checkmark-circle" size={20} color={colors.light.success} />
            <Text style={styles.badgeText}>Уже в контактах</Text>
          </View>
          <TouchableOpacity 
            style={styles.button}
            onPress={() => {
              const chat = getChatByParticipant(userId!);
              if (chat) router.replace(`/chat/${chat.id}`);
              else router.replace('/(tabs)');
            }}
          >
            <Ionicons name="chatbubble" size={20} color="#FFF" />
            <Text style={styles.buttonText}>Открыть чат</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity 
          style={styles.button} 
          onPress={handleAddContact}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="person-add" size={20} color="#FFF" />
              <Text style={styles.buttonText}>Добавить в контакты</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.light.background,
  },
  name: {
    ...typography.h2,
    color: colors.light.textPrimary,
    marginTop: spacing.md,
  },
  userId: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginTop: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.light.inputBackground,
    borderRadius: 20,
  },
  badgeText: {
    ...typography.body,
    color: colors.light.success,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.light.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: spacing.xl,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    ...typography.body,
    color: colors.light.error,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
