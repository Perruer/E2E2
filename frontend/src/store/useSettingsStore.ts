/**
 * XAMTON Settings Store
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'xamton:settings';

interface Settings {
  theme: 'light' | 'dark';
  notificationsEnabled: boolean;
  soundEnabled: boolean;
}

const defaultSettings: Settings = {
  theme: 'light',
  notificationsEnabled: true,
  soundEnabled: true,
};

interface SettingsStore extends Settings {
  loadSettings: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleNotifications: () => void;
  toggleSound: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...defaultSettings,

  loadSettings: async () => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        set(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Load settings error:', err);
    }
  },

  setTheme: (theme) => {
    set({ theme });
    const { notificationsEnabled, soundEnabled } = get();
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, notificationsEnabled, soundEnabled })).catch(console.error);
  },

  toggleNotifications: () => {
    const notificationsEnabled = !get().notificationsEnabled;
    set({ notificationsEnabled });
    const { theme, soundEnabled } = get();
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, notificationsEnabled, soundEnabled })).catch(console.error);
  },

  toggleSound: () => {
    const soundEnabled = !get().soundEnabled;
    set({ soundEnabled });
    const { theme, notificationsEnabled } = get();
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, notificationsEnabled, soundEnabled })).catch(console.error);
  },
}));
