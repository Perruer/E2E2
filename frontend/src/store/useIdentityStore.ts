/**
 * XAMTON Identity Store
 * Управление криптографической идентичностью пользователя
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Identity } from '../core/crypto/types';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import 'react-native-get-random-values';

const IDENTITY_KEY = 'xamton:identity';
const DISPLAY_NAME_KEY = 'xamton:displayName';

function generateUserId(): string {
  const bytes = nacl.randomBytes(8);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function serializeIdentity(identity: Identity): string {
  return JSON.stringify({
    userId: identity.userId,
    identityKeyPair: {
      publicKey: encodeBase64(identity.identityKeyPair.publicKey),
      secretKey: encodeBase64(identity.identityKeyPair.secretKey),
      signingPublicKey: identity.identityKeyPair.signingPublicKey
        ? encodeBase64(identity.identityKeyPair.signingPublicKey)
        : undefined,
    },
    createdAt: identity.createdAt,
  });
}

function deserializeIdentity(data: string): Identity {
  const obj = JSON.parse(data);
  return {
    userId: obj.userId,
    identityKeyPair: {
      publicKey: decodeBase64(obj.identityKeyPair.publicKey),
      secretKey: decodeBase64(obj.identityKeyPair.secretKey),
      signingPublicKey: obj.identityKeyPair.signingPublicKey
        ? decodeBase64(obj.identityKeyPair.signingPublicKey)
        : undefined,
    },
    createdAt: obj.createdAt,
  };
}

interface IdentityStore {
  identity: Identity | null;
  displayName: string | null;
  isOnboarded: boolean;
  isLoading: boolean;

  initializeIdentity: () => Promise<void>;
  createNewIdentity: () => Promise<Identity>;
  setDisplayName: (name: string) => Promise<void>;
  deleteIdentity: () => Promise<void>;
}

export const useIdentityStore = create<IdentityStore>((set, get) => ({
  identity: null,
  displayName: null,
  isOnboarded: false,
  isLoading: true,

  initializeIdentity: async () => {
    set({ isLoading: true });
    try {
      const [storedIdentity, storedName] = await Promise.all([
        AsyncStorage.getItem(IDENTITY_KEY),
        AsyncStorage.getItem(DISPLAY_NAME_KEY),
      ]);

      if (storedIdentity) {
        const identity = deserializeIdentity(storedIdentity);
        set({
          identity,
          displayName: storedName,
          isOnboarded: true,
          isLoading: false,
        });
      } else {
        set({ isOnboarded: false, isLoading: false });
      }
    } catch (err) {
      console.error('Identity init error:', err);
      set({ isLoading: false });
    }
  },

  createNewIdentity: async () => {
    const keyPair = nacl.box.keyPair();
    const signingKeyPair = nacl.sign.keyPair();
    const userId = generateUserId();

    const identity: Identity = {
      userId,
      identityKeyPair: {
        publicKey: keyPair.publicKey,
        secretKey: keyPair.secretKey,
        signingPublicKey: signingKeyPair.publicKey,
      },
      createdAt: Date.now(),
    };

    await AsyncStorage.setItem(IDENTITY_KEY, serializeIdentity(identity));
    set({ identity, isOnboarded: true });
    return identity;
  },

  setDisplayName: async (name: string) => {
    await AsyncStorage.setItem(DISPLAY_NAME_KEY, name);
    set({ displayName: name });
  },

  deleteIdentity: async () => {
    await AsyncStorage.multiRemove([IDENTITY_KEY, DISPLAY_NAME_KEY]);
    set({ identity: null, displayName: null, isOnboarded: false });
  },
}));
