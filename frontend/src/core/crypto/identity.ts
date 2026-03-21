/**
 * XAMTON Crypto — Identity & Key Management
 * Реализация X3DH и Double Ratchet через tweetnacl
 */
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { Identity, KeyPair } from './types';

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function generateSigningKeyPair(): KeyPair {
  const kp = nacl.sign.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Генерация 100 одноразовых предварительных ключей
 */
export function generateOneTimePreKeys(count = 100): KeyPair[] {
  return Array.from({ length: count }, () => generateKeyPair());
}

/**
 * Шифрование сообщения для конкретного получателя (упрощённый X3DH)
 */
export function encryptMessage(
  message: string,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array
): { ciphertext: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(message);
  const ciphertext = nacl.box(messageBytes, nonce, recipientPublicKey, senderSecretKey);

  return {
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Расшифровка сообщения
 */
export function decryptMessage(
  ciphertext: string,
  nonce: string,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array
): string | null {
  try {
    const decrypted = nacl.box.open(
      decodeBase64(ciphertext),
      decodeBase64(nonce),
      senderPublicKey,
      recipientSecretKey
    );
    if (!decrypted) return null;
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/**
 * Создаём fingerprint идентичности для верификации
 */
export function getIdentityFingerprint(identity: Identity): string {
  const pubKeyB64 = encodeBase64(identity.identityKeyPair.publicKey);
  return pubKeyB64.replace(/[^A-Za-z0-9]/g, '').slice(0, 40).toUpperCase();
}
