/**
 * XAMTON Chat Store
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Chat, Message } from '../core/crypto/types';
import { v4 as uuidv4 } from 'uuid';

const CHATS_KEY = 'xamton:chats';
const MESSAGES_PREFIX = 'xamton:messages:';

interface ChatStore {
  chats: Chat[];
  messages: Record<string, Message[]>;

  loadChats: () => Promise<void>;
  getChat: (id: string) => Chat | undefined;
  getChatByParticipant: (userId: string) => Chat | undefined;
  createChat: (participantIds: string[], name?: string) => Promise<Chat>;
  addMessage: (chatId: string, message: Message) => Promise<void>;
  markAsRead: (chatId: string) => void;
  deleteAllData: () => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  messages: {},

  loadChats: async () => {
    try {
      const stored = await AsyncStorage.getItem(CHATS_KEY);
      if (stored) {
        const chats: Chat[] = JSON.parse(stored);

        // Загружаем сообщения для каждого чата
        const messagesEntries = await Promise.all(
          chats.map(async chat => {
            const raw = await AsyncStorage.getItem(MESSAGES_PREFIX + chat.id);
            const msgs: Message[] = raw ? JSON.parse(raw) : [];
            return [chat.id, msgs] as [string, Message[]];
          })
        );

        set({
          chats,
          messages: Object.fromEntries(messagesEntries),
        });
      }
    } catch (err) {
      console.error('Load chats error:', err);
    }
  },

  getChat: (id) => {
    return get().chats.find(c => c.id === id);
  },

  getChatByParticipant: (userId) => {
    return get().chats.find(
      c => c.type === 'direct' && c.participantIds.includes(userId)
    );
  },

  createChat: async (participantIds, name) => {
    const chat: Chat = {
      id: uuidv4(),
      type: participantIds.length === 2 ? 'direct' : 'group',
      name,
      participantIds,
      unreadCount: 0,
      createdAt: Date.now(),
    };

    const chats = [...get().chats, chat];
    await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    set({ chats });
    return chat;
  },

  addMessage: async (chatId, message) => {
    const state = get();
    const chatMessages = [...(state.messages[chatId] || []), message];

    // Обновляем сообщения в памяти и на диске
    const newMessages = { ...state.messages, [chatId]: chatMessages };
    await AsyncStorage.setItem(MESSAGES_PREFIX + chatId, JSON.stringify(chatMessages));

    // Обновляем lastMessage в чате
    const chats = state.chats.map(c => {
      if (c.id !== chatId) return c;
      return {
        ...c,
        lastMessage: message,
        lastMessageAt: message.timestamp,
        unreadCount: c.unreadCount + 1,
      };
    });
    await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));

    set({ messages: newMessages, chats });
  },

  markAsRead: (chatId) => {
    const chats = get().chats.map(c =>
      c.id === chatId ? { ...c, unreadCount: 0 } : c
    );
    set({ chats });
    AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats)).catch(console.error);
  },

  deleteAllData: async () => {
    const keys = await AsyncStorage.getAllKeys();
    const xamtonKeys = keys.filter(k => k.startsWith('xamton:'));
    await AsyncStorage.multiRemove(xamtonKeys);
    set({ chats: [], messages: {} });
  },
}));
