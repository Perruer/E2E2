/**
 * XAMTON Onboarding Screen
 * Генерация ключей и первый запуск
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  SafeAreaView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIdentityStore } from '../src/store/useIdentityStore';
import { colors } from '../src/theme/colors';
import { typography } from '../src/theme/typography';
import { spacing } from '../src/theme/spacing';

export default function OnboardingScreen() {
  const router = useRouter();
  const { createNewIdentity, setDisplayName, identity } = useIdentityStore();
  
  const [step, setStep] = useState<'welcome' | 'generating' | 'name' | 'complete'>('welcome');
  const [progress, setProgress] = useState(0);
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const handleStart = async () => {
    setStep('generating');
    
    // Анимация прогресса
    Animated.timing(progressAnim, {
      toValue: 100,
      duration: 2500,
      useNativeDriver: false,
    }).start();

    // Обновляем прогресс
    const interval = setInterval(() => {
      setProgress(prev => Math.min(prev + 5, 95));
    }, 100);

    try {
      // Генерируем ключи
      const newIdentity = await createNewIdentity();
      clearInterval(interval);
      setProgress(100);
      setUserId(newIdentity.userId);
      
      // Переходим к вводу имени
      setTimeout(() => setStep('name'), 500);
    } catch (error) {
      clearInterval(interval);
      Alert.alert('Ошибка', 'Не удалось сгенерировать ключи');
      setStep('welcome');
    }
  };

  const handleNameSubmit = async () => {
    if (name.trim()) {
      await setDisplayName(name.trim());
    }
    setStep('complete');
  };

  const handleComplete = () => {
    router.replace('/(tabs)');
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Welcome Step */}
        {step === 'welcome' && (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <View style={styles.logoContainer}>
              <View style={styles.logo}>
                <Ionicons name="diamond" size={48} color={colors.light.primary} />
              </View>
              <Text style={styles.logoText}>XAMTON</Text>
            </View>
            
            <Text style={styles.tagline}>
              Связь, которую невозможно отключить
            </Text>
            
            <View style={styles.features}>
              <FeatureItem icon="lock-closed" text="E2E шифрование" />
              <FeatureItem icon="git-network" text="P2P архитектура" />
              <FeatureItem icon="bluetooth" text="Mesh-сети" />
              <FeatureItem icon="shield-checkmark" text="Без серверов" />
            </View>
            
            <TouchableOpacity style={styles.primaryButton} onPress={handleStart}>
              <Text style={styles.primaryButtonText}>Начать</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Generating Step */}
        {step === 'generating' && (
          <View style={styles.stepContainer}>
            <View style={styles.logoContainer}>
              <View style={styles.logo}>
                <Ionicons name="key" size={48} color={colors.light.primary} />
              </View>
            </View>
            
            <Text style={styles.title}>Генерация ключей...</Text>
            <Text style={styles.subtitle}>
              Создаём вашу криптографическую идентичность
            </Text>
            
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
              </View>
              <Text style={styles.progressText}>{progress}%</Text>
            </View>
            
            <View style={styles.keyInfo}>
              <Text style={styles.keyLabel}>Создаётся:</Text>
              <Text style={styles.keyItem}>✓ Identity Key (Curve25519)</Text>
              <Text style={styles.keyItem}>✓ Signed Pre-Key</Text>
              <Text style={styles.keyItem}>✓ 100 One-Time Pre-Keys</Text>
            </View>
          </View>
        )}

        {/* Name Step */}
        {step === 'name' && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Как вас зовут?</Text>
            <Text style={styles.subtitle}>
              Это имя увидят ваши собеседники
            </Text>
            
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Ваше имя"
              placeholderTextColor={colors.light.inputPlaceholder}
              autoFocus
              maxLength={32}
            />
            
            <View style={styles.userIdContainer}>
              <Text style={styles.userIdLabel}>Ваш ID:</Text>
              <Text style={styles.userId} numberOfLines={1}>
                {userId}
              </Text>
            </View>
            
            <TouchableOpacity 
              style={[styles.primaryButton, !name.trim() && styles.buttonDisabled]} 
              onPress={handleNameSubmit}
            >
              <Text style={styles.primaryButtonText}>Продолжить</Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={handleNameSubmit}>
              <Text style={styles.skipText}>Пропустить</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <View style={styles.stepContainer}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={80} color={colors.light.success} />
            </View>
            
            <Text style={styles.title}>Готово!</Text>
            <Text style={styles.subtitle}>
              Ваши ключи созданы и хранятся{"\n"}
              только на вашем устройстве
            </Text>
            
            <View style={styles.warningBox}>
              <Ionicons name="warning" size={24} color={colors.light.warning} />
              <Text style={styles.warningText}>
                Серверов нет. Ваши ключи — только у вас.{"\n"}
                Рекомендуем сохранить резервную копию!
              </Text>
            </View>
            
            <TouchableOpacity style={styles.secondaryButton}>
              <Ionicons name="download-outline" size={20} color={colors.light.primary} />
              <Text style={styles.secondaryButtonText}>Сохранить бэкап ключей</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.primaryButton} onPress={handleComplete}>
              <Text style={styles.primaryButtonText}>Начать общение</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <Ionicons name={icon as any} size={24} color={colors.light.primary} />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  stepContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.light.inputBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logoText: {
    ...typography.h1,
    color: colors.light.primary,
    letterSpacing: 4,
  },
  tagline: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  features: {
    width: '100%',
    marginBottom: spacing.xl,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  featureText: {
    ...typography.body,
    color: colors.light.textPrimary,
  },
  title: {
    ...typography.h2,
    color: colors.light.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: colors.light.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: spacing.borderRadiusMd,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButtonText: {
    ...typography.button,
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.light.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: spacing.borderRadiusMd,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.light.primary,
  },
  progressContainer: {
    width: '100%',
    marginBottom: spacing.xl,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.light.inputBackground,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.light.primary,
  },
  progressText: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  keyInfo: {
    alignItems: 'flex-start',
    width: '100%',
  },
  keyLabel: {
    ...typography.bodySmall,
    color: colors.light.textSecondary,
    marginBottom: spacing.sm,
  },
  keyItem: {
    ...typography.bodySmall,
    color: colors.light.textPrimary,
    marginBottom: 4,
  },
  nameInput: {
    ...typography.h3,
    width: '100%',
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: colors.light.primary,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
    color: colors.light.textPrimary,
  },
  userIdContainer: {
    backgroundColor: colors.light.inputBackground,
    padding: spacing.md,
    borderRadius: spacing.borderRadiusMd,
    width: '100%',
    marginBottom: spacing.xl,
  },
  userIdLabel: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginBottom: 4,
  },
  userId: {
    ...typography.bodySmall,
    color: colors.light.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  skipText: {
    ...typography.body,
    color: colors.light.textSecondary,
    marginTop: spacing.md,
  },
  successIcon: {
    marginBottom: spacing.lg,
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 149, 0, 0.1)',
    padding: spacing.md,
    borderRadius: spacing.borderRadiusMd,
    marginTop: spacing.xl,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  warningText: {
    ...typography.bodySmall,
    color: colors.light.textPrimary,
    flex: 1,
  },
});
