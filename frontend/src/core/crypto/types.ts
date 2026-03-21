/**
 * XAMTON — Core Types
 */

export type TransportType = 'internet' | 'dns' | 'mesh_ble' | 'mesh_wifi' | 'offline';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageContent {
  type: 'text' | 'image' | 'file' | 'audio';
  text?: string;
  url?: string;
  filename?: string;
  size?: number;
  duration?: number;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  type: 'text' | 'image' | 'file' | 'audio' | 'system';
  content: MessageContent;
  timestamp: number;
  status: MessageStatus;
  transportUsed: TransportType;
  encryptedPayload?: string;
}

export interface Chat {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  participantIds: string[];
  lastMessage?: Message;
  lastMessageAt?: number;
  unreadCount: number;
  createdAt: number;
}

export interface Contact {
  id: string;
  userId: string;
  name: string;
  identityKey?: string;
  verified: boolean;
  addedAt: number;
}

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface IdentityKeyPair extends KeyPair {
  signingPublicKey?: Uint8Array;
}

export interface Identity {
  userId: string;
  identityKeyPair: IdentityKeyPair;
  signedPreKey?: KeyPair;
  oneTimePreKeys?: KeyPair[];
  createdAt: number;
}

export interface TransportState {
  enabled: boolean;
  connected: boolean;
  peerCount: number;
  latency?: number;
}

export interface NetworkStats {
  onlineUsers: number;
  totalMessages: number;
  activePeers: number;
}
