/**
 * XAMTON Server API Client
 * HTTP-клиент для взаимодействия с бэкендом
 */

import { encodeBase64 } from 'tweetnacl-util';
import { UserIdentity, PreKeyBundle } from '../crypto/types';

// TODO: вынести в настройки / .env
const DEFAULT_SERVER = 'https://xamton.onrender.com';

let _serverUrl = DEFAULT_SERVER;

export function setServerUrl(url: string) {
  _serverUrl = url.replace(/\/+$/, '');
}

export function getServerUrl(): string {
  return _serverUrl;
}

function apiUrl(path: string): string {
  return `${_serverUrl}/api${path}`;
}

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ============ User Registration ============

export async function registerUser(
  identity: UserIdentity,
  displayName?: string,
): Promise<{ success: boolean; user_id: string }> {
  return request('/users/register', {
    method: 'POST',
    body: JSON.stringify({
      user_id: identity.userId,
      display_name: displayName || undefined,
      identity_key: encodeBase64(identity.identityKeyPair.publicKey),
      signing_key: identity.identityKeyPair.signingPublicKey
        ? encodeBase64(identity.identityKeyPair.signingPublicKey)
        : undefined,
    }),
  });
}

export async function getUser(userId: string): Promise<{
  user_id: string;
  display_name?: string;
  identity_key: string;
  last_seen?: string;
} | null> {
  try {
    return await request(`/users/${userId}`);
  } catch {
    return null;
  }
}

// ============ PreKey Bundles ============

export async function uploadPreKeyBundle(identity: UserIdentity): Promise<void> {
  const otpks = identity.oneTimePreKeys.map(k => ({
    id: k.keyId,
    key: encodeBase64(k.keyPair.publicKey),
  }));

  await request('/prekeys', {
    method: 'POST',
    body: JSON.stringify({
      user_id: identity.userId,
      identity_key: encodeBase64(identity.identityKeyPair.publicKey),
      signed_prekey_id: identity.signedPreKey.keyId,
      signed_prekey: encodeBase64(identity.signedPreKey.keyPair.publicKey),
      signed_prekey_signature: encodeBase64(identity.signedPreKey.signature),
      one_time_prekeys: otpks,
    }),
  });
}

export async function fetchPreKeyBundle(userId: string): Promise<PreKeyBundle | null> {
  try {
    const { decodeBase64 } = require('tweetnacl-util');
    const data = await request(`/prekeys/${userId}`);

    // Также try fetching the user's signing_key for SPK verification
    const user = await getUser(userId);

    return {
      identityKey: decodeBase64(data.identity_key),
      signingKey: user?.identity_key ? undefined : undefined, // signing_key comes from user record
      signedPreKey: {
        keyId: data.signed_prekey_id,
        publicKey: decodeBase64(data.signed_prekey),
        signature: decodeBase64(data.signed_prekey_signature),
      },
      oneTimePreKey: data.one_time_prekey
        ? {
            keyId: data.one_time_prekey_id,
            publicKey: decodeBase64(data.one_time_prekey),
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

// ============ Messages (Store-and-Forward) ============

export async function fetchPendingMessages(userId: string): Promise<any[]> {
  try {
    const data = await request(`/messages/${userId}`);
    return data.messages || [];
  } catch {
    return [];
  }
}

export async function storeMessage(
  senderId: string,
  recipientId: string,
  payload: string,
  signature: string,
): Promise<string | null> {
  try {
    const data = await request('/messages', {
      method: 'POST',
      body: JSON.stringify({
        sender_id: senderId,
        recipient_id: recipientId,
        payload,
        signature,
        ttl_hours: 72,
      }),
    });
    return data.message_id || null;
  } catch {
    return null;
  }
}

export async function deleteServerMessage(messageId: string): Promise<void> {
  try {
    await request(`/messages/${messageId}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

// ============ Health ============

export async function checkHealth(): Promise<boolean> {
  try {
    const data = await request('/health');
    return data.status === 'healthy';
  } catch {
    return false;
  }
}
