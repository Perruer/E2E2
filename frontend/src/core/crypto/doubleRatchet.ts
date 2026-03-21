/**
 * XAMTON Double Ratchet Algorithm
 * End-to-End шифрование сообщений
 * 
 * Исправления:
 * 1. KDF функции используют HMAC-SHA-512 вместо nacl.hash
 * 2. Добавлен лимит на пропущенные ключи (MAX_SKIP_MESSAGE_KEYS)
 * 3. Constant-time сравнение ключей вместо base64 строк
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { RatchetState, EncryptedMessage, KeyPair } from './types';
import { hmacSHA512, hkdf, constantTimeEqual, MAX_SKIP_MESSAGE_KEYS } from './hmac';

// FFI Interface
export interface DoubleRatchetFFI {
  initializeSender(sharedSecret: Uint8Array, remotePublicKey: Uint8Array): RatchetState;
  initializeReceiver(sharedSecret: Uint8Array): RatchetState;
  encrypt(state: RatchetState, plaintext: Uint8Array): { state: RatchetState; message: EncryptedMessage };
  decrypt(state: RatchetState, message: EncryptedMessage): { state: RatchetState; plaintext: Uint8Array };
}

/**
 * KDF для цепочки сообщений (symmetric ratchet)
 * Использует HMAC-SHA-512: chain key → (new chain key, message key)
 * 
 * В Signal: CK_new = HMAC(CK, 0x02), MK = HMAC(CK, 0x01)
 */
function kdfChain(chainKey: Uint8Array): { newChainKey: Uint8Array; messageKey: Uint8Array } {
  const mkInput = new Uint8Array([0x01]);
  const ckInput = new Uint8Array([0x02]);
  
  const messageKey = hmacSHA512(chainKey, mkInput).slice(0, 32);
  const newChainKey = hmacSHA512(chainKey, ckInput).slice(0, 32);
  
  return { newChainKey, messageKey };
}

/**
 * KDF для root key (DH ratchet)
 * Использует HKDF: (root key, DH output) → (new root key, chain key)
 */
function kdfRoot(rootKey: Uint8Array, dhOutput: Uint8Array): { newRootKey: Uint8Array; chainKey: Uint8Array } {
  const info = new TextEncoder().encode('XAMTON_Ratchet_v2');
  const output = hkdf(dhOutput, rootKey, info, 64);
  
  return {
    newRootKey: output.slice(0, 32),
    chainKey: output.slice(32, 64),
  };
}

class JSDoubleRatchetImpl implements DoubleRatchetFFI {
  initializeSender(sharedSecret: Uint8Array, remotePublicKey: Uint8Array): RatchetState {
    const dhKeyPair = nacl.box.keyPair();
    const dhOutput = nacl.scalarMult(dhKeyPair.secretKey, remotePublicKey);
    const { newRootKey, chainKey } = kdfRoot(sharedSecret, dhOutput);
    
    return {
      rootKey: newRootKey,
      chainKey: chainKey,
      sendingChainKey: chainKey,
      receivingChainKey: undefined,
      dhRatchetKey: dhKeyPair,
      remoteDHRatchetKey: remotePublicKey,
      sendingChainLength: 0,
      receivingChainLength: 0,
      previousChainLength: 0,
      messageKeys: new Map(),
    };
  }

  initializeReceiver(sharedSecret: Uint8Array): RatchetState {
    const dhKeyPair = nacl.box.keyPair();
    
    return {
      rootKey: sharedSecret,
      chainKey: sharedSecret,
      sendingChainKey: undefined,
      receivingChainKey: undefined,
      dhRatchetKey: dhKeyPair,
      remoteDHRatchetKey: undefined,
      sendingChainLength: 0,
      receivingChainLength: 0,
      previousChainLength: 0,
      messageKeys: new Map(),
    };
  }

  encrypt(state: RatchetState, plaintext: Uint8Array): { state: RatchetState; message: EncryptedMessage } {
    if (!state.sendingChainKey || !state.dhRatchetKey) {
      throw new Error('Ratchet state not initialized for sending');
    }

    // Derive message key
    const { newChainKey, messageKey } = kdfChain(state.sendingChainKey);
    
    // Generate nonce
    const nonce = nacl.randomBytes(24);
    
    // Encrypt
    const ciphertext = nacl.secretbox(plaintext, nonce, messageKey);
    
    const message: EncryptedMessage = {
      header: {
        dhPublicKey: state.dhRatchetKey.publicKey,
        previousChainLength: state.previousChainLength,
        messageNumber: state.sendingChainLength,
      },
      ciphertext,
      nonce,
    };

    const newState: RatchetState = {
      ...state,
      sendingChainKey: newChainKey,
      sendingChainLength: state.sendingChainLength + 1,
    };

    return { state: newState, message };
  }

  decrypt(state: RatchetState, message: EncryptedMessage): { state: RatchetState; plaintext: Uint8Array } {
    let newState = { ...state, messageKeys: new Map(state.messageKeys) };
    
    // Check if we need to perform DH ratchet
    // Используем constant-time сравнение вместо base64 строк
    const headerDH = message.header.dhPublicKey;
    const needsRatchet = !state.remoteDHRatchetKey || 
        !constantTimeEqual(headerDH, state.remoteDHRatchetKey);
    
    if (needsRatchet) {
      // Perform DH ratchet
      newState = this.dhRatchet(newState, headerDH);
    }

    if (!newState.receivingChainKey) {
      throw new Error('No receiving chain key');
    }

    // Проверяем лимит пропущенных ключей (защита от DoS)
    const skippedCount = message.header.messageNumber - newState.receivingChainLength;
    if (skippedCount > MAX_SKIP_MESSAGE_KEYS) {
      throw new Error(`Too many skipped messages: ${skippedCount} exceeds limit of ${MAX_SKIP_MESSAGE_KEYS}`);
    }

    // Skip to correct message number, сохраняя пропущенные ключи
    let chainKey = newState.receivingChainKey;
    for (let i = newState.receivingChainLength; i < message.header.messageNumber; i++) {
      const { newChainKey, messageKey } = kdfChain(chainKey);
      // Store skipped message keys с лимитом
      const skippedKeyId = `${encodeBase64(headerDH)}_${i}`;
      newState.messageKeys.set(skippedKeyId, messageKey);
      
      // Удаляем самые старые ключи если превышен лимит
      if (newState.messageKeys.size > MAX_SKIP_MESSAGE_KEYS) {
        const firstKey = newState.messageKeys.keys().next().value;
        if (firstKey !== undefined) {
          newState.messageKeys.delete(firstKey);
        }
      }
      
      chainKey = newChainKey;
    }

    // Derive message key for this message
    const { newChainKey, messageKey } = kdfChain(chainKey);
    
    // Decrypt
    const plaintext = nacl.secretbox.open(message.ciphertext, message.nonce, messageKey);
    if (!plaintext) {
      throw new Error('Decryption failed');
    }

    newState.receivingChainKey = newChainKey;
    newState.receivingChainLength = message.header.messageNumber + 1;

    return { state: newState, plaintext };
  }

  private dhRatchet(state: RatchetState, remotePublicKey: Uint8Array): RatchetState {
    if (!state.dhRatchetKey) {
      throw new Error('No DH ratchet key');
    }

    // Derive receiving chain
    const dhOutput1 = nacl.scalarMult(state.dhRatchetKey.secretKey, remotePublicKey);
    const { newRootKey: rootKey1, chainKey: receivingChainKey } = kdfRoot(state.rootKey, dhOutput1);

    // Generate new DH key pair
    const newDHKeyPair = nacl.box.keyPair();

    // Derive sending chain
    const dhOutput2 = nacl.scalarMult(newDHKeyPair.secretKey, remotePublicKey);
    const { newRootKey: rootKey2, chainKey: sendingChainKey } = kdfRoot(rootKey1, dhOutput2);

    return {
      ...state,
      rootKey: rootKey2,
      chainKey: rootKey2,
      sendingChainKey,
      receivingChainKey,
      dhRatchetKey: newDHKeyPair,
      remoteDHRatchetKey: remotePublicKey,
      previousChainLength: state.sendingChainLength,
      sendingChainLength: 0,
      receivingChainLength: 0,
    };
  }
}

export const doubleRatchetFFI: DoubleRatchetFFI = new JSDoubleRatchetImpl();

// Сериализация состояния рatchет
export function serializeRatchetState(state: RatchetState): string {
  const serializable = {
    rootKey: encodeBase64(state.rootKey),
    chainKey: encodeBase64(state.chainKey),
    sendingChainKey: state.sendingChainKey ? encodeBase64(state.sendingChainKey) : null,
    receivingChainKey: state.receivingChainKey ? encodeBase64(state.receivingChainKey) : null,
    dhRatchetKey: state.dhRatchetKey ? {
      publicKey: encodeBase64(state.dhRatchetKey.publicKey),
      secretKey: encodeBase64(state.dhRatchetKey.secretKey),
    } : null,
    remoteDHRatchetKey: state.remoteDHRatchetKey ? encodeBase64(state.remoteDHRatchetKey) : null,
    sendingChainLength: state.sendingChainLength,
    receivingChainLength: state.receivingChainLength,
    previousChainLength: state.previousChainLength,
    messageKeys: Array.from(state.messageKeys.entries()).map(([k, v]) => [k, encodeBase64(v)]),
  };
  return JSON.stringify(serializable);
}

export function deserializeRatchetState(data: string): RatchetState {
  const parsed = JSON.parse(data);
  return {
    rootKey: decodeBase64(parsed.rootKey),
    chainKey: decodeBase64(parsed.chainKey),
    sendingChainKey: parsed.sendingChainKey ? decodeBase64(parsed.sendingChainKey) : undefined,
    receivingChainKey: parsed.receivingChainKey ? decodeBase64(parsed.receivingChainKey) : undefined,
    dhRatchetKey: parsed.dhRatchetKey ? {
      publicKey: decodeBase64(parsed.dhRatchetKey.publicKey),
      secretKey: decodeBase64(parsed.dhRatchetKey.secretKey),
    } : undefined,
    remoteDHRatchetKey: parsed.remoteDHRatchetKey ? decodeBase64(parsed.remoteDHRatchetKey) : undefined,
    sendingChainLength: parsed.sendingChainLength,
    receivingChainLength: parsed.receivingChainLength,
    previousChainLength: parsed.previousChainLength,
    messageKeys: new Map(parsed.messageKeys.map(([k, v]: [string, string]) => [k, decodeBase64(v)])),
  };
}
