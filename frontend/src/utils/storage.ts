/**
 * XAMTON Platform-agnostic Storage
 * Использует AsyncStorage для всех платформ
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Unified storage API - использует AsyncStorage везде
export const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch (e) {
      console.warn('storage getItem failed:', e);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      console.warn('storage setItem failed:', e);
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
      console.warn('storage removeItem failed:', e);
    }
  },

  async multiRemove(keys: string[]): Promise<void> {
    try {
      await AsyncStorage.multiRemove(keys);
    } catch (e) {
      console.warn('storage multiRemove failed:', e);
    }
  },

  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    try {
      const result = await AsyncStorage.multiGet(keys);
      return result as [string, string | null][];
    } catch (e) {
      console.warn('storage multiGet failed:', e);
      return keys.map(key => [key, null]);
    }
  },
};

export default storage;
