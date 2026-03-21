/**
 * XAMTON WebSocket Service
 * Realtime-соединение с сервером
 * 
 * Возможности:
 * - Ed25519 challenge-response аутентификация
 * - Авто-реконнект с exponential backoff
 * - Ping/pong keepalive
 * - Offline-очередь сообщений
 * - Event emitter для входящих сообщений
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { getServerUrl } from './ServerAPI';

export type WSEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'auth_success' }
  | { type: 'auth_failed' }
  | { type: 'new_message'; message: any }
  | { type: 'pending_message'; message: any }
  | { type: 'message_ack'; message_id: string; delivered: boolean }
  | { type: 'typing'; sender_id: string }
  | { type: 'peers_list'; peers: string[]; count: number }
  | { type: 'error'; error: string };

type WSListener = (event: WSEvent) => void;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private userId: string = '';
  private signingSecretKey: Uint8Array | null = null;
  private listeners: Set<WSListener> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30000;
  private offlineQueue: any[] = [];
  private _connected = false;
  private _authenticated = false;
  private intentionalClose = false;

  get connected(): boolean {
    return this._connected && this._authenticated;
  }

  /**
   * Подключиться к серверу
   */
  connect(userId: string, signingSecretKey?: Uint8Array): void {
    this.userId = userId;
    this.signingSecretKey = signingSecretKey || null;
    this.intentionalClose = false;
    this.doConnect();
  }

  /**
   * Отключиться от сервера
   */
  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
  }

  /**
   * Отправить сообщение через WebSocket
   * Если нет соединения — кладём в очередь
   */
  send(data: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this._authenticated) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    // Offline queue (только для сообщений, не для пингов)
    if (data.type === 'message') {
      this.offlineQueue.push(data);
    }
    return false;
  }

  /**
   * Отправить зашифрованное сообщение получателю
   */
  sendMessage(recipientId: string, payload: string): boolean {
    return this.send({
      type: 'message',
      recipient_id: recipientId,
      payload,
    });
  }

  /**
   * Отправить typing indicator
   */
  sendTyping(recipientId: string): void {
    this.send({ type: 'typing', recipient_id: recipientId });
  }

  /**
   * Подписаться на события
   */
  on(listener: WSListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============ Private ============

  private doConnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try { this.ws.close(); } catch {}
    }

    const serverUrl = getServerUrl();
    // http → ws, https → wss
    const wsUrl = serverUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:');

    const url = `${wsUrl}/api/ws/${encodeURIComponent(this.userId)}`;
    console.log('[WS] Connecting to', url.slice(0, 60) + '...');

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this._connected = true;
      this.reconnectAttempt = 0;
      this.emit({ type: 'connected' });
      // Auth will happen via server challenge
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };

    this.ws.onclose = (event) => {
      console.log('[WS] Closed:', event.code, event.reason);
      this._connected = false;
      this._authenticated = false;
      this.stopPing();
      this.emit({ type: 'disconnected' });

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };
  }

  private handleMessage(data: any): void {
    switch (data.type) {
      case 'auth_challenge':
        this.handleAuthChallenge(data.challenge);
        break;

      case 'auth_success':
        console.log('[WS] Authenticated');
        this._authenticated = true;
        this.startPing();
        this.flushOfflineQueue();
        this.emit({ type: 'auth_success' });
        break;

      case 'auth_failed':
        console.error('[WS] Auth failed');
        this._authenticated = false;
        this.emit({ type: 'auth_failed' });
        break;

      case 'new_message':
        this.emit({ type: 'new_message', message: data.message });
        break;

      case 'pending_message':
        this.emit({ type: 'pending_message', message: data.message });
        break;

      case 'message_ack':
        this.emit({
          type: 'message_ack',
          message_id: data.message_id,
          delivered: data.delivered,
        });
        break;

      case 'typing':
        this.emit({ type: 'typing', sender_id: data.sender_id });
        break;

      case 'peers_list':
        this.emit({ type: 'peers_list', peers: data.peers, count: data.count });
        break;

      case 'pong':
        // keepalive OK
        break;

      case 'error':
        this.emit({ type: 'error', error: data.error });
        break;

      default:
        console.log('[WS] Unknown message type:', data.type);
    }
  }

  private handleAuthChallenge(challengeB64: string): void {
    if (!this.signingSecretKey) {
      // Нет ключа — отправляем пустую подпись (legacy fallback, сервер примет)
      console.warn('[WS] No signing key, sending empty auth response');
      this.ws?.send(JSON.stringify({
        type: 'auth_response',
        signature: '',
      }));
      return;
    }

    try {
      const challenge = decodeBase64(challengeB64);
      // Ed25519 sign: tweetnacl sign.detached(message, secretKey)
      const signature = nacl.sign.detached(challenge, this.signingSecretKey);
      this.ws?.send(JSON.stringify({
        type: 'auth_response',
        signature: encodeBase64(signature),
      }));
    } catch (err) {
      console.error('[WS] Auth sign error:', err);
      this.ws?.send(JSON.stringify({
        type: 'auth_response',
        signature: '',
      }));
    }
  }

  private flushOfflineQueue(): void {
    if (this.offlineQueue.length === 0) return;
    console.log(`[WS] Flushing ${this.offlineQueue.length} queued messages`);
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    for (const msg of queue) {
      this.send(msg);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay,
    );
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      this.doConnect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000); // каждые 25 секунд
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this._connected = false;
    this._authenticated = false;
  }

  private emit(event: WSEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[WS] Listener error:', err);
      }
    }
  }
}

// Singleton
export const wsService = new WebSocketService();
