/**
 * XAMTON Session Manager
 * Управление криптографическими сессиями
 * 
 * - Инициация X3DH handshake
 * - Хранение RatchetState в AsyncStorage
 * - Шифрование/дешифрование сообщений
 */

import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import storage from '../../utils/storage';
import { UserIdentity, RatchetState, EncryptedMessage, PreKeyBundle } from '../crypto/types';
import { x3dhFFI } from '../crypto/x3dh';
import {
  doubleRatchetFFI,
  serializeRatchetState,
  deserializeRatchetState,
} from '../crypto/doubleRatchet';
import { fetchPreKeyBundle } from './ServerAPI';

const SESSION_PREFIX = '@xamton_session_';

/**
 * Envelope, отправляемый по сети
 */
export interface WireMessage {
  v: 1; // version
  sid: string; // sender userId
  // X3DH initial message fields (only present in first message)
  x3dh?: {
    ek: string; // ephemeral public key (base64)
    otpk?: number; // used one-time prekey id
  };
  // Double Ratchet encrypted message
  hdr: {
    dh: string; // DH public key (base64)
    pn: number; // previous chain length
    n: number; // message number
  };
  ct: string; // ciphertext (base64)
  nc: string; // nonce (base64)
}

export class SessionManager {
  private sessions: Map<string, RatchetState> = new Map();
  private identity: UserIdentity | null = null;

  setIdentity(identity: UserIdentity): void {
    this.identity = identity;
  }

  /**
   * Загрузить сессию из storage
   */
  async loadSession(peerUserId: string): Promise<RatchetState | null> {
    // Check memory cache first
    const cached = this.sessions.get(peerUserId);
    if (cached) return cached;

    try {
      const data = await storage.getItem(SESSION_PREFIX + peerUserId);
      if (data) {
        const state = deserializeRatchetState(data);
        this.sessions.set(peerUserId, state);
        return state;
      }
    } catch (err) {
      console.error('[Session] Load error:', err);
    }
    return null;
  }

  /**
   * Сохранить сессию
   */
  private async saveSession(peerUserId: string, state: RatchetState): Promise<void> {
    this.sessions.set(peerUserId, state);
    try {
      await storage.setItem(SESSION_PREFIX + peerUserId, serializeRatchetState(state));
    } catch (err) {
      console.error('[Session] Save error:', err);
    }
  }

  /**
   * Есть ли активная сессия с пиром
   */
  async hasSession(peerUserId: string): Promise<boolean> {
    const session = await this.loadSession(peerUserId);
    return session !== null;
  }

  /**
   * Инициировать новую сессию (X3DH) и зашифровать первое сообщение
   * Возвращает WireMessage или null если не удалось получить PreKeyBundle
   */
  async initiateAndEncrypt(
    peerUserId: string,
    plaintext: string,
  ): Promise<WireMessage | null> {
    if (!this.identity) throw new Error('Identity not set');

    // Получаем PreKeyBundle пира с сервера
    const bundle = await fetchPreKeyBundle(peerUserId);
    if (!bundle) {
      console.warn('[Session] Cannot fetch prekey bundle for', peerUserId.slice(0, 16));
      return null;
    }

    // X3DH
    const x3dhResult = x3dhFFI.initiateSession(this.identity, bundle);

    // Initialize Double Ratchet as sender
    const ratchetState = doubleRatchetFFI.initializeSender(
      x3dhResult.sharedSecret,
      bundle.signedPreKey.publicKey, // remote DH ratchet key
    );

    // Encrypt first message
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const { state: newState, message } = doubleRatchetFFI.encrypt(ratchetState, plaintextBytes);

    // Save session
    await this.saveSession(peerUserId, newState);

    // Build wire message with X3DH data
    const wireMsg: WireMessage = {
      v: 1,
      sid: this.identity.userId,
      x3dh: {
        ek: encodeBase64(x3dhResult.ephemeralPublic),
        otpk: x3dhResult.usedOneTimePreKeyId,
      },
      hdr: {
        dh: encodeBase64(message.header.dhPublicKey),
        pn: message.header.previousChainLength,
        n: message.header.messageNumber,
      },
      ct: encodeBase64(message.ciphertext),
      nc: encodeBase64(message.nonce),
    };

    return wireMsg;
  }

  /**
   * Зашифровать сообщение в существующей сессии
   */
  async encrypt(peerUserId: string, plaintext: string): Promise<WireMessage | null> {
    if (!this.identity) throw new Error('Identity not set');

    const session = await this.loadSession(peerUserId);
    if (!session) {
      // Нет сессии — нужно инициировать X3DH
      return this.initiateAndEncrypt(peerUserId, plaintext);
    }

    const plaintextBytes = new TextEncoder().encode(plaintext);
    const { state: newState, message } = doubleRatchetFFI.encrypt(session, plaintextBytes);

    await this.saveSession(peerUserId, newState);

    const wireMsg: WireMessage = {
      v: 1,
      sid: this.identity.userId,
      hdr: {
        dh: encodeBase64(message.header.dhPublicKey),
        pn: message.header.previousChainLength,
        n: message.header.messageNumber,
      },
      ct: encodeBase64(message.ciphertext),
      nc: encodeBase64(message.nonce),
    };

    return wireMsg;
  }

  /**
   * Дешифровать входящее сообщение
   */
  async decrypt(wireMsg: WireMessage): Promise<string | null> {
    if (!this.identity) throw new Error('Identity not set');

    const senderId = wireMsg.sid;

    // Reconstruct EncryptedMessage
    const encMsg: EncryptedMessage = {
      header: {
        dhPublicKey: decodeBase64(wireMsg.hdr.dh),
        previousChainLength: wireMsg.hdr.pn,
        messageNumber: wireMsg.hdr.n,
      },
      ciphertext: decodeBase64(wireMsg.ct),
      nonce: decodeBase64(wireMsg.nc),
    };

    let session = await this.loadSession(senderId);

    // Если нет сессии и есть X3DH данные — это первое сообщение
    if (!session && wireMsg.x3dh) {
      const ephemeralKey = decodeBase64(wireMsg.x3dh.ek);
      
      // Нам нужен identity key отправителя. Берём из контактов.
      // Для простоты: предполагаем что контакт уже добавлен и его identityKey доступен
      // через колбэк. Пока используем fallback через X3DH accept.
      // В реальности нужно получить identityKey отправителя.
      
      // Для MVP: получаем identity key с сервера
      const { getUser } = require('./ServerAPI');
      const senderUser = await getUser(senderId);
      if (!senderUser) {
        console.error('[Session] Cannot find sender identity key');
        return null;
      }

      const senderIdentityKey = decodeBase64(senderUser.identity_key);

      // X3DH accept
      const sharedSecret = x3dhFFI.acceptSession(
        this.identity,
        senderIdentityKey,
        ephemeralKey,
        wireMsg.x3dh.otpk,
      );

      // Initialize Double Ratchet as receiver
      session = doubleRatchetFFI.initializeReceiver(sharedSecret);
    }

    if (!session) {
      console.error('[Session] No session and no X3DH data for', senderId.slice(0, 16));
      return null;
    }

    try {
      const { state: newState, plaintext } = doubleRatchetFFI.decrypt(session, encMsg);
      await this.saveSession(senderId, newState);
      return new TextDecoder().decode(plaintext);
    } catch (err) {
      console.error('[Session] Decrypt error:', err);
      return null;
    }
  }

  /**
   * Удалить сессию
   */
  async deleteSession(peerUserId: string): Promise<void> {
    this.sessions.delete(peerUserId);
    try {
      await storage.removeItem(SESSION_PREFIX + peerUserId);
    } catch {}
  }
}

// Singleton
export const sessionManager = new SessionManager();
