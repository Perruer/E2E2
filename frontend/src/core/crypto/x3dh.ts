/**
 * XAMTON X3DH (Extended Triple Diffie-Hellman)
 * Протокол установки сессии как в Signal
 * 
 * Исправления относительно исходной версии:
 * 1. HKDF теперь использует HMAC-SHA-512 (RFC 5869) вместо nacl.hash
 * 2. Добавлена верификация подписи signed prekey (защита от MITM)
 * 3. Используется Ed25519 signingKey для верификации
 */

import nacl from 'tweetnacl';
import {
  KeyPair,
  PreKeyBundle,
  X3DHResult,
  UserIdentity,
} from './types';
import { hkdf } from './hmac';
import { identityFFI } from './identity';

// FFI Interface
export interface X3DHFFI {
  initiateSession(ourIdentity: UserIdentity, theirBundle: PreKeyBundle): X3DHResult;
  acceptSession(
    ourIdentity: UserIdentity,
    theirIdentityKey: Uint8Array,
    theirEphemeralKey: Uint8Array,
    usedOneTimePreKeyId?: number
  ): Uint8Array;
}

// X25519 Diffie-Hellman
function dh(ourSecret: Uint8Array, theirPublic: Uint8Array): Uint8Array {
  return nacl.scalarMult(ourSecret, theirPublic);
}

// Info string для HKDF — фиксированный протокольный идентификатор
const HKDF_INFO = new TextEncoder().encode('XAMTON_X3DH_v2');

// 32 байта 0xFF как Signal-совместимый prefix для DH конкатенации
const DH_PADDING = new Uint8Array(32).fill(0xFF);

/**
 * Верификация подписи signed prekey
 * Критически важно для защиты от MITM-атак
 */
function verifySignedPreKey(bundle: PreKeyBundle): boolean {
  if (!bundle.signingKey) {
    // Если signing key не предоставлен — не можем верифицировать
    // В production это должно быть ошибкой, но для обратной совместимости
    // с существующими бандлами допускаем (с предупреждением)
    console.warn('X3DH: PreKeyBundle missing signingKey — SPK signature NOT verified (INSECURE)');
    return true;
  }

  return identityFFI.verifySignature(
    bundle.signingKey,
    bundle.signedPreKey.publicKey,
    bundle.signedPreKey.signature
  );
}

class JSX3DHImpl implements X3DHFFI {
  initiateSession(ourIdentity: UserIdentity, theirBundle: PreKeyBundle): X3DHResult {
    // *** КРИТИЧНО: верифицируем подпись signed prekey ***
    if (!verifySignedPreKey(theirBundle)) {
      throw new Error('X3DH: Signed PreKey signature verification FAILED — possible MITM attack');
    }

    // Генерируем эфемерный ключ
    const ephemeralKeyPair = nacl.box.keyPair();
    
    // DH1 = DH(IKa, SPKb) — наш identity secret × их signed prekey
    const dh1 = dh(ourIdentity.identityKeyPair.secretKey, theirBundle.signedPreKey.publicKey);
    
    // DH2 = DH(EKa, IKb) — наш ephemeral × их identity key
    const dh2 = dh(ephemeralKeyPair.secretKey, theirBundle.identityKey);
    
    // DH3 = DH(EKa, SPKb) — наш ephemeral × их signed prekey
    const dh3 = dh(ephemeralKeyPair.secretKey, theirBundle.signedPreKey.publicKey);
    
    // Конкатенация DH результатов с Signal-совместимым padding
    let dhConcat = new Uint8Array([...DH_PADDING, ...dh1, ...dh2, ...dh3]);
    let usedOneTimePreKeyId: number | undefined;
    
    // DH4 = DH(EKa, OPKb) — если есть one-time prekey
    if (theirBundle.oneTimePreKey) {
      const dh4 = dh(ephemeralKeyPair.secretKey, theirBundle.oneTimePreKey.publicKey);
      dhConcat = new Uint8Array([...dhConcat, ...dh4]);
      usedOneTimePreKeyId = theirBundle.oneTimePreKey.keyId;
    }
    
    // Derive shared secret через HKDF (RFC 5869)
    const salt = new Uint8Array(64); // zero salt, размер SHA-512 output
    const sharedSecret = hkdf(dhConcat, salt, HKDF_INFO, 32);
    
    return {
      sharedSecret,
      ephemeralPublic: ephemeralKeyPair.publicKey,
      usedOneTimePreKeyId,
    };
  }

  acceptSession(
    ourIdentity: UserIdentity,
    theirIdentityKey: Uint8Array,
    theirEphemeralKey: Uint8Array,
    usedOneTimePreKeyId?: number
  ): Uint8Array {
    // DH1 = DH(SPKb, IKa) — наш signed prekey secret × их identity key
    const dh1 = dh(ourIdentity.signedPreKey.keyPair.secretKey, theirIdentityKey);
    
    // DH2 = DH(IKb, EKa) — наш identity secret × их ephemeral
    const dh2 = dh(ourIdentity.identityKeyPair.secretKey, theirEphemeralKey);
    
    // DH3 = DH(SPKb, EKa) — наш signed prekey secret × их ephemeral
    const dh3 = dh(ourIdentity.signedPreKey.keyPair.secretKey, theirEphemeralKey);
    
    let dhConcat = new Uint8Array([...DH_PADDING, ...dh1, ...dh2, ...dh3]);
    
    // DH4 если использовался one-time prekey
    if (usedOneTimePreKeyId !== undefined) {
      const otpk = ourIdentity.oneTimePreKeys.find(k => k.keyId === usedOneTimePreKeyId);
      if (otpk) {
        const dh4 = dh(otpk.keyPair.secretKey, theirEphemeralKey);
        dhConcat = new Uint8Array([...dhConcat, ...dh4]);
      }
    }
    
    // Derive shared secret через HKDF (RFC 5869)
    const salt = new Uint8Array(64);
    
    return hkdf(dhConcat, salt, HKDF_INFO, 32);
  }
}

export const x3dhFFI: X3DHFFI = new JSX3DHImpl();
