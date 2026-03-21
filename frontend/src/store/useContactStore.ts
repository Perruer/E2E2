/**
 * XAMTON Contact Store
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contact } from '../core/crypto/types';
import { v4 as uuidv4 } from 'uuid';

const CONTACTS_KEY = 'xamton:contacts';

interface ContactStore {
  contacts: Contact[];

  loadContacts: () => Promise<void>;
  getContact: (userId: string) => Contact | undefined;
  addContact: (userId: string, name: string, identityKey?: Uint8Array | string, verified?: boolean) => Promise<Contact>;
  deleteContact: (id: string) => Promise<void>;
  deleteAllContacts: () => Promise<void>;
}

export const useContactStore = create<ContactStore>((set, get) => ({
  contacts: [],

  loadContacts: async () => {
    try {
      const stored = await AsyncStorage.getItem(CONTACTS_KEY);
      if (stored) {
        set({ contacts: JSON.parse(stored) });
      }
    } catch (err) {
      console.error('Load contacts error:', err);
    }
  },

  getContact: (userId) => {
    return get().contacts.find(c => c.userId === userId);
  },

  addContact: async (userId, name, identityKey, verified = false) => {
    // Если контакт уже есть — обновляем
    const existing = get().contacts.find(c => c.userId === userId);
    if (existing) {
      const contacts = get().contacts.map(c =>
        c.userId === userId ? { ...c, name, verified } : c
      );
      await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
      set({ contacts });
      return get().contacts.find(c => c.userId === userId)!;
    }

    // Сериализуем ключ если это Uint8Array
    let keyStr: string | undefined;
    if (identityKey instanceof Uint8Array) {
      const { encodeBase64 } = require('tweetnacl-util');
      keyStr = encodeBase64(identityKey);
    } else {
      keyStr = identityKey;
    }

    const contact: Contact = {
      id: uuidv4(),
      userId,
      name,
      identityKey: keyStr,
      verified,
      addedAt: Date.now(),
    };

    const contacts = [...get().contacts, contact];
    await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
    set({ contacts });
    return contact;
  },

  deleteContact: async (id) => {
    const contacts = get().contacts.filter(c => c.id !== id);
    await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
    set({ contacts });
  },

  deleteAllContacts: async () => {
    await AsyncStorage.removeItem(CONTACTS_KEY);
    set({ contacts: [] });
  },
}));
