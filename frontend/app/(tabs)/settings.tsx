/**
 * XAMTON Settings Screen
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIdentityStore } from '../../src/store/useIdentityStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { useChatStore } from '../../src/store/useChatStore';
import { useContactStore } from '../../src/store/useContactStore';
import { Avatar } from '../../src/components/common/Avatar';
import { colors } from '../../src/theme/colors';
import { typography } from '../../src/theme/typography';
import { spacing } from '../../src/theme/spacing';

export default function SettingsScreen() {
  const router = useRouter();
  const { identity, displayName, deleteIdentity } = useIdentityStore();
  const { theme, setTheme, notificationsEnabled, toggleNotifications, soundEnabled, toggleSound } = useSettingsStore();
  const { deleteAllData } = useChatStore();
  const { deleteAllContacts } = useContactStore();

  const handleNetworkSettings = () => {
    router.push('/network');
  };

  const handlePanicButton = () => {
    Alert.alert(
      'Режим "Тревога"',
      'Это уничтожит ВСЕ данные: ключи, чаты, контакты. Восстановить будет невозможно!',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Уничтожить всё',
          style: 'destructive',
          onPress: async () => {
            await deleteIdentity();
            await deleteAllData();
            await deleteAllContacts();
            router.replace('/onboarding');
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* Profile Section */}
      <TouchableOpacity style={styles.profileSection}>
        <Avatar name={displayName || 'User'} size="large" />
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{displayName || 'Имя не указано'}</Text>
          <Text style={styles.profileId} numberOfLines={1}>
            {identity?.userId || ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.light.textTertiary} />
      </TouchableOpacity>

      {/* Appearance */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Внешний вид</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: '#5856D6' }]}>
              <Ionicons name="moon" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.settingLabel}>Тёмная тема</Text>
          </View>
          <Switch
            value={theme === 'dark'}
            onValueChange={(value) => setTheme(value ? 'dark' : 'light')}
            trackColor={{ false: colors.light.border, true: colors.light.primary }}
          />
        </View>
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Уведомления</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.light.danger }]}>
              <Ionicons name="notifications" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.settingLabel}>Уведомления</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={toggleNotifications}
            trackColor={{ false: colors.light.border, true: colors.light.primary }}
          />
        </View>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.light.warning }]}>
              <Ionicons name="volume-high" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.settingLabel}>Звук</Text>
          </View>
          <Switch
            value={soundEnabled}
            onValueChange={toggleSound}
            trackColor={{ false: colors.light.border, true: colors.light.primary }}
          />
        </View>
      </View>

      {/* Network */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Сеть</Text>
        <TouchableOpacity style={styles.settingRow} onPress={handleNetworkSettings}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.light.transportMesh }]}>
              <Ionicons name="git-network" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.settingLabel}>Сеть и транспорт</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.light.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* Security */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Безопасность</Text>
        <TouchableOpacity style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.light.success }]}>
              <Ionicons name="key" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.settingLabel}>Экспорт ключей</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.light.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.light.primary }]}>
              <Ionicons name="qr-code" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.settingLabel}>Мой QR-код</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.light.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* Danger Zone */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.light.danger }]}>Опасная зона</Text>
        <TouchableOpacity style={styles.dangerRow} onPress={handlePanicButton}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.light.danger }]}>
              <Ionicons name="warning" size={18} color="#FFFFFF" />
            </View>
            <View>
              <Text style={[styles.settingLabel, { color: colors.light.danger }]}>Режим "Тревога"</Text>
              <Text style={styles.settingHint}>Уничтожить все данные</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* Version */}
      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>XAMTON v1.0.0</Text>
        <Text style={styles.versionText}>Связь, которую невозможно отключить</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.inputBackground,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.light.background,
    marginBottom: spacing.lg,
  },
  profileInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  profileName: {
    ...typography.h3,
    color: colors.light.textPrimary,
  },
  profileId: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginTop: 2,
  },
  section: {
    backgroundColor: colors.light.background,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.light.textSecondary,
    textTransform: 'uppercase',
    marginLeft: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.separator,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 30,
    height: 30,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  settingLabel: {
    ...typography.body,
    color: colors.light.textPrimary,
  },
  settingHint: {
    ...typography.caption,
    color: colors.light.textSecondary,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: 'rgba(255, 59, 48, 0.05)',
  },
  versionContainer: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  versionText: {
    ...typography.caption,
    color: colors.light.textTertiary,
  },
});
