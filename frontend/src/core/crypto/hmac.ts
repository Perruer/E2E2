/**
 * XAMTON HMAC & HKDF Utilities
 * Корректная реализация RFC 5869 (HKDF) поверх HMAC-SHA-512
 * 
 * tweetnacl предоставляет только nacl.hash (SHA-512), но не HMAC.
 * Реализуем HMAC-SHA-512 вручную, затем HKDF поверх него.
 */

import nacl from 'tweetnacl';

const SHA512_BLOCK_SIZE = 128; // SHA-512 block size in bytes
const SHA512_HASH_SIZE = 64;   // SHA-512 output size in bytes

/**
 * HMAC-SHA-512 (RFC 2104)
 * 
 * HMAC(K, m) = H((K' ⊕ opad) || H((K' ⊕ ipad) || m))
 * где K' = H(K) если len(K) > block_size, иначе K padded to block_size
 */
export function hmacSHA512(key: Uint8Array, data: Uint8Array): Uint8Array {
  let normalizedKey: Uint8Array;

  // Если ключ длиннее block size, хешируем его
  if (key.length > SHA512_BLOCK_SIZE) {
    normalizedKey = nacl.hash(key);
  } else {
    normalizedKey = new Uint8Array(key);
  }

  // Паддим ключ до block size нулями
  const paddedKey = new Uint8Array(SHA512_BLOCK_SIZE);
  paddedKey.set(normalizedKey);

  // ipad = 0x36 repeated, opad = 0x5c repeated
  const ipadKey = new Uint8Array(SHA512_BLOCK_SIZE);
  const opadKey = new Uint8Array(SHA512_BLOCK_SIZE);

  for (let i = 0; i < SHA512_BLOCK_SIZE; i++) {
    ipadKey[i] = paddedKey[i] ^ 0x36;
    opadKey[i] = paddedKey[i] ^ 0x5c;
  }

  // inner = H(ipadKey || data)
  const innerInput = new Uint8Array(SHA512_BLOCK_SIZE + data.length);
  innerInput.set(ipadKey);
  innerInput.set(data, SHA512_BLOCK_SIZE);
  const innerHash = nacl.hash(innerInput);

  // outer = H(opadKey || inner)
  const outerInput = new Uint8Array(SHA512_BLOCK_SIZE + SHA512_HASH_SIZE);
  outerInput.set(opadKey);
  outerInput.set(innerHash, SHA512_BLOCK_SIZE);
  
  return nacl.hash(outerInput);
}

/**
 * HKDF-SHA-512 (RFC 5869)
 * 
 * Шаг 1: Extract — PRK = HMAC-SHA-512(salt, IKM)
 * Шаг 2: Expand  — OKM = T(1) || T(2) || ... где T(i) = HMAC-SHA-512(PRK, T(i-1) || info || i)
 */
export function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  // Step 1: Extract
  // Если salt пустой, используем строку нулей размером hash
  const effectiveSalt = salt.length > 0 ? salt : new Uint8Array(SHA512_HASH_SIZE);
  const prk = hmacSHA512(effectiveSalt, ikm);

  // Step 2: Expand
  const n = Math.ceil(length / SHA512_HASH_SIZE);
  if (n > 255) {
    throw new Error('HKDF: requested length too large');
  }

  const result = new Uint8Array(n * SHA512_HASH_SIZE);
  let t = new Uint8Array(0); // T(0) = empty

  for (let i = 1; i <= n; i++) {
    // T(i) = HMAC-SHA-512(PRK, T(i-1) || info || i)
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t);
    input.set(info, t.length);
    input[t.length + info.length] = i;

    t = hmacSHA512(prk, input);
    result.set(t, (i - 1) * SHA512_HASH_SIZE);
  }

  return result.slice(0, length);
}

/**
 * Constant-time сравнение двух Uint8Array
 * Защита от timing attacks
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Максимальное количество пропущенных ключей сообщений
 * Защита от DoS через раздувание хранилища
 */
export const MAX_SKIP_MESSAGE_KEYS = 2000;
