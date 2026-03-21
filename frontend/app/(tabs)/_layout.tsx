/**
 * XAMTON Tabs Layout
 */

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors';
import { useSettingsStore } from '../../src/store/useSettingsStore';

export default function TabsLayout() {
  const theme = useSettingsStore(state => state.theme);
  const themeColors = colors[theme];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: themeColors.primary,
        tabBarInactiveTintColor: themeColors.textSecondary,
        tabBarStyle: {
          backgroundColor: themeColors.background,
          borderTopColor: themeColors.separator,
        },
        headerStyle: {
          backgroundColor: themeColors.header,
        },
        headerTintColor: themeColors.headerText,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Чаты',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={size} color={color} />
          ),
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Контакты',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Настройки',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
