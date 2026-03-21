/**
 * XAMTON - Entry Point
 * Перенаправление на нужный экран
 */

import { useEffect } from 'react';
import { useRouter, useRootNavigationState } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useIdentityStore } from '../src/store/useIdentityStore';
import { colors } from '../src/theme/colors';

export default function Index() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const { isOnboarded, isLoading } = useIdentityStore();

  useEffect(() => {
    if (!rootNavigationState?.key) return;
    if (isLoading) return;

    if (isOnboarded) {
      router.replace('/(tabs)');
    } else {
      router.replace('/onboarding');
    }
  }, [isOnboarded, isLoading, rootNavigationState?.key]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.light.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.light.background,
  },
});
