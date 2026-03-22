/**
 * XAMTON - Главный лейаут приложения
 */
import 'react-native-get-random-values';

import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useIdentityStore } from '../src/store/useIdentityStore';
import { useChatStore } from '../src/store/useChatStore';
import { useContactStore } from '../src/store/useContactStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { colors } from '../src/theme/colors';
import { messagePipeline } from '../src/core/network/MessagePipeline';
import { requestAllPermissions } from '../src/core/network/Permissions';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const initializeIdentity = useIdentityStore(state => state.initializeIdentity);
  const loadChats = useChatStore(state => state.loadChats);
  const loadContacts = useContactStore(state => state.loadContacts);
  const loadSettings = useSettingsStore(state => state.loadSettings);
  const theme = useSettingsStore(state => state.theme);
  const identity = useIdentityStore(state => state.identity);
  const displayName = useIdentityStore(state => state.displayName);

  useEffect(() => {
    async function initialize() {
      try {
        await Promise.all([
          initializeIdentity(),
          loadChats(),
          loadContacts(),
          loadSettings(),
        ]);

        // Запрашиваем разрешения для BLE/WiFi
        await requestAllPermissions();

      } catch (error) {
        console.error('Initialization error:', error);
      } finally {
        setIsReady(true);
      }
    }
    initialize();
  }, []);

  // Инициализация MessagePipeline после загрузки identity
  useEffect(() => {
    if (identity && isReady) {
      messagePipeline.initialize(identity, displayName || undefined).catch((err) => {
        console.warn('Pipeline init error:', err);
      });
    }

    return () => {
      // Очистка при размонтировании
    };
  }, [identity?.userId, isReady]);

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.light.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: colors[theme].header,
          },
          headerTintColor: colors[theme].headerText,
          headerTitleStyle: {
            fontWeight: '600',
          },
          contentStyle: {
            backgroundColor: colors[theme].background,
          },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="chat/[id]"
          options={{ headerShown: true, title: '' }}
        />
        <Stack.Screen
          name="newchat"
          options={{ title: 'Новый чат', presentation: 'modal' }}
        />
        <Stack.Screen
          name="qrscan"
          options={{ title: 'Сканировать QR', presentation: 'modal' }}
        />
        <Stack.Screen
          name="invite"
          options={{ title: 'Приглашение', presentation: 'modal' }}
        />
        <Stack.Screen name="network" options={{ title: 'Сеть и транспорт' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.light.background,
  },
});
