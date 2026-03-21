/**
 * XAMTON MessagePipeline v2
 * Исправлено: auth без ожидания challenge, дедупликация сообщений, логи
 */
import { Identity, Message, TransportType } from '../crypto/types';
import { useTransportStore } from '../../store/useTransportStore';
import { v4 as uuidv4 } from 'uuid';

const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL || 'https://e2e2-backend.onrender.com';
const WS_URL = RELAY_URL.replace('https://', 'wss://').replace('http://', 'ws://');

class MessagePipeline {
  private ws: WebSocket | null = null;
  private identity: Identity | null = null;
  private displayName?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectDelay = 2000;
  private isDestroyed = false;
  private pendingAcks: Map<string, (delivered: boolean) => void> = new Map();
  private deliveredIds: Set<string> = new Set();

  async initialize(identity: Identity, displayName?: string) {
    this.identity = identity;
    this.displayName = displayName;
    this.isDestroyed = false;

    try {
      await this.registerUser();
    } catch (err) {
      console.warn('[Pipeline] Register error:', err);
    }

    this.connect();
  }

  private async registerUser() {
    if (!this.identity) return;
    const { encodeBase64 } = require('tweetnacl-util');

    const res = await fetch(`${RELAY_URL}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: this.identity.userId,
        display_name: this.displayName || this.identity.userId.slice(0, 12),
        identity_key: encodeBase64(this.identity.identityKeyPair.publicKey),
      }),
    });

    if (!res.ok) throw new Error(`Register failed: ${res.status}`);
    const data = await res.json();
    console.log('[Pipeline] Registered:', data);
    return data;
  }

  private connect() {
    if (!this.identity || this.isDestroyed) return;

    console.log('[Pipeline] Connecting to', `${WS_URL}/api/ws/${this.identity.userId.slice(0, 8)}...`);

    try {
      this.ws = new WebSocket(`${WS_URL}/api/ws/${this.identity.userId}`);

      this.ws.onopen = () => {
        console.log('[Pipeline] WS open — sending auth_response immediately');
        this.reconnectDelay = 2000;

        // Сервер может пропустить auth_challenge для legacy пользователей
        // Отправляем пустой auth_response сразу после открытия
        this.ws?.send(JSON.stringify({ type: 'auth_response', signature: '' }));

        // Считаем себя подключёнными и забираем офлайн сообщения
        useTransportStore.getState().setTransportConnected('internet', true);
        this.fetchOfflineMessages();

        // Ping каждые 25с
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[Pipeline] ←', data.type);
          this.handleServerMessage(data);
        } catch (err) {
          console.warn('[Pipeline] Parse error:', err);
        }
      };

      this.ws.onclose = (e) => {
        console.log('[Pipeline] WS closed', e.code, e.reason);
        clearInterval(this.pingTimer);
        useTransportStore.getState().setTransportConnected('internet', false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        console.warn('[Pipeline] WS error');
      };
    } catch (err) {
      console.warn('[Pipeline] Connect error:', err);
      this.scheduleReconnect();
    }
  }

  private handleServerMessage(data: any) {
    switch (data.type) {
      case 'auth_challenge':
        // Дополнительно отвечаем если пришёл challenge
        this.ws?.send(JSON.stringify({ type: 'auth_response', signature: '' }));
        break;

      case 'auth_success':
        useTransportStore.getState().setTransportConnected('internet', true);
        console.log('[Pipeline] Auth success confirmed by server');
        break;

      case 'auth_failed':
        console.error('[Pipeline] Auth failed');
        this.ws?.close();
        break;

      case 'pending_message':
      case 'new_message':
        if (data.message) {
          this.deliverIncomingMessage(data.message);
        }
        break;

      case 'message_ack': {
        const resolve = this.pendingAcks.get(data.message_id);
        if (resolve) {
          resolve(!!data.delivered);
          this.pendingAcks.delete(data.message_id);
        }
        break;
      }

      case 'peer_connected':
        useTransportStore.getState().setTotalPeers(data.online_users || 0);
        break;

      case 'pong':
      case 'typing':
        break;

      default:
        console.log('[Pipeline] Unknown message type:', data.type);
        break;
    }
  }

  private scheduleReconnect() {
    if (this.isDestroyed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  private async fetchOfflineMessages() {
    if (!this.identity) return;
    try {
      console.log('[Pipeline] Fetching offline messages...');
      const res = await fetch(`${RELAY_URL}/api/messages/${this.identity.userId}`);
      if (!res.ok) {
        console.warn('[Pipeline] Offline fetch failed:', res.status);
        return;
      }
      const data = await res.json();
      console.log('[Pipeline] Offline messages:', data.count || 0);
      for (const msg of data.messages || []) {
        await this.deliverIncomingMessage(msg);
      }
    } catch (err) {
      console.warn('[Pipeline] Offline fetch error:', err);
    }
  }

  private async deliverIncomingMessage(raw: any) {
    if (!this.identity) return;

    const senderId: string = raw.sender_id;
    if (!senderId || senderId === this.identity.userId) return;

    // Дедупликация
    const msgId = raw.id || '';
    if (msgId && this.deliveredIds.has(msgId)) {
      console.log('[Pipeline] Duplicate message skipped:', msgId);
      return;
    }
    if (msgId) this.deliveredIds.add(msgId);

    const { useChatStore } = require('../../store/useChatStore');
    const { useContactStore } = require('../../store/useContactStore');

    const chatStore = useChatStore.getState();
    const contactStore = useContactStore.getState();

    let chat = chatStore.getChatByParticipant(senderId);
    if (!chat) {
      const contact = contactStore.getContact(senderId);
      chat = await chatStore.createChat(
        [this.identity.userId, senderId],
        contact?.name
      );
    }

    // Парсим payload
    let textContent = '';
    try {
      const payload =
        typeof raw.payload === 'string' ? JSON.parse(raw.payload) : raw.payload;
      textContent = typeof payload === 'object' ? (payload?.text ?? '') : String(payload ?? '');
    } catch {
      textContent = String(raw.payload ?? '[зашифровано]');
    }

    console.log('[Pipeline] Delivering message from', senderId.slice(0, 8), ':', textContent.slice(0, 30));

    const message: Message = {
      id: msgId || uuidv4(),
      chatId: chat.id,
      senderId,
      type: 'text',
      content: { type: 'text', text: textContent },
      timestamp: raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now(),
      status: 'delivered',
      transportUsed: 'internet' as TransportType,
    };

    await chatStore.addMessage(chat.id, message);
  }

  async sendTextMessage(chatId: string, recipientId: string, text: string): Promise<void> {
    if (!this.identity) throw new Error('Not initialized');

    const messageId = uuidv4();
    const { useChatStore } = require('../../store/useChatStore');
    const chatStore = useChatStore.getState();

    const localMessage: Message = {
      id: messageId,
      chatId,
      senderId: this.identity.userId,
      type: 'text',
      content: { type: 'text', text },
      timestamp: Date.now(),
      status: 'sending',
      transportUsed: 'internet' as TransportType,
    };
    await chatStore.addMessage(chatId, localMessage);

    const payload = JSON.stringify({ text });

    // Отправляем через WS
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[Pipeline] → message via WS to', recipientId.slice(0, 8));
      this.ws.send(
        JSON.stringify({
          type: 'message',
          recipient_id: recipientId,
          payload,
          message_id: messageId,
        })
      );

      const delivered = await new Promise<boolean>((resolve) => {
        this.pendingAcks.set(messageId, resolve);
        setTimeout(() => {
          if (this.pendingAcks.has(messageId)) {
            this.pendingAcks.delete(messageId);
            resolve(false);
          }
        }, 5000);
      });

      this.setMessageStatus(chatId, messageId, delivered ? 'delivered' : 'sent');
      return;
    }

    // Fallback: HTTP store-and-forward
    console.log('[Pipeline] WS not open, using HTTP fallback');
    try {
      const res = await fetch(`${RELAY_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: this.identity.userId,
          recipient_id: recipientId,
          payload,
        }),
      });
      this.setMessageStatus(chatId, messageId, res.ok ? 'sent' : 'failed');
    } catch (err) {
      console.warn('[Pipeline] HTTP fallback failed:', err);
      this.setMessageStatus(chatId, messageId, 'failed');
      throw new Error('Нет подключения к серверу');
    }
  }

  private setMessageStatus(chatId: string, messageId: string, status: Message['status']) {
    const { useChatStore } = require('../../store/useChatStore');
    useChatStore.setState((state: any) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map((m: Message) =>
          m.id === messageId ? { ...m, status } : m
        ),
      },
    }));
  }

  destroy() {
    this.isDestroyed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.pendingAcks.clear();
  }
}

export const messagePipeline = new MessagePipeline();
