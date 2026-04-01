/**
 * XAMTON MessagePipeline v4
 * Мультитранспортная система: WebSocket → BLE Mesh → WiFi Direct → DNS → HTTP
 * 
 * Изменения v4:
 * - BLE: используем новый нативный модуль (убрали react-native-ble-plx и ble-advertiser)
 * - BLEAdvertiser.ts больше не нужен — advertising встроен в BLETransport
 */
import { Identity, Message, TransportType } from '../crypto/types';
import { useTransportStore } from '../../store/useTransportStore';
import { v4 as uuidv4 } from 'uuid';

const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL || 'https://xamton-relay.onrender.com';
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

  // ─── Инициализация ───────────────────────────────────────────────────────

  async initialize(identity: Identity, displayName?: string) {
    this.identity = identity;
    this.displayName = displayName;
    this.isDestroyed = false;

    try { await this.registerUser(); } catch (err) {
      console.warn('[Pipeline] Register error:', err);
    }

    this.connect();
    // Запускаем все транспорты параллельно
    this.initializeTransports().catch(console.warn);
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
    return res.json();
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────

  private connect() {
    if (!this.identity || this.isDestroyed) return;

    try {
      this.ws = new WebSocket(`${WS_URL}/api/ws/${this.identity.userId}`);

      this.ws.onopen = () => {
        console.log('[Pipeline] WS connected');
        this.reconnectDelay = 2000;
        // Legacy auth — сервер примет пустую подпись
        this.ws?.send(JSON.stringify({ type: 'auth_response', signature: '' }));
        useTransportStore.getState().setTransportConnected('internet', true);
        this.fetchOfflineMessages();

        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (err) {
          console.warn('[Pipeline] Parse error:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[Pipeline] WS disconnected');
        clearInterval(this.pingTimer);
        useTransportStore.getState().setTransportConnected('internet', false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => console.warn('[Pipeline] WS error');
    } catch (err) {
      console.warn('[Pipeline] Connect error:', err);
      this.scheduleReconnect();
    }
  }

  private handleServerMessage(data: any) {
    switch (data.type) {
      case 'auth_challenge':
        this.ws?.send(JSON.stringify({ type: 'auth_response', signature: '' }));
        break;
      case 'auth_success':
        useTransportStore.getState().setTransportConnected('internet', true);
        break;
      case 'auth_failed':
        this.ws?.close();
        break;
      case 'pending_message':
      case 'new_message':
        if (data.message) this.deliverIncomingMessage(data.message);
        break;
      case 'message_ack': {
        const resolve = this.pendingAcks.get(data.message_id);
        if (resolve) { resolve(!!data.delivered); this.pendingAcks.delete(data.message_id); }
        break;
      }
      case 'peer_connected':
        useTransportStore.getState().setTotalPeers(data.online_users || 0);
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
      const res = await fetch(`${RELAY_URL}/api/messages/${this.identity.userId}`);
      if (!res.ok) return;
      const data = await res.json();
      console.log('[Pipeline] Offline messages:', data.count || 0);
      for (const msg of data.messages || []) {
        await this.deliverIncomingMessage(msg);
      }
    } catch (err) {
      console.warn('[Pipeline] Offline fetch error:', err);
    }
  }

  // ─── Доставка входящих сообщений (общая для всех транспортов) ────────────

  async deliverIncomingMessage(raw: any) {
    if (!this.identity) return;

    const senderId: string = raw.sender_id;
    if (!senderId || senderId === this.identity.userId) return;

    // Дедупликация
    const msgId = raw.id || '';
    if (msgId && this.deliveredIds.has(msgId)) return;
    if (msgId) this.deliveredIds.add(msgId);

    const { useChatStore } = require('../../store/useChatStore');
    const { useContactStore } = require('../../store/useContactStore');
    const chatStore = useChatStore.getState();
    const contactStore = useContactStore.getState();

    let chat = chatStore.getChatByParticipant(senderId);
    if (!chat) {
      const contact = contactStore.getContact(senderId);
      chat = await chatStore.createChat([this.identity.userId, senderId], contact?.name);
    }

    let textContent = '';
    try {
      const payload = typeof raw.payload === 'string' ? JSON.parse(raw.payload) : raw.payload;
      textContent = typeof payload === 'object' ? (payload?.text ?? '') : String(payload ?? '');
    } catch {
      textContent = String(raw.payload ?? '[зашифровано]');
    }

    const transport: TransportType = raw.transport || 'internet';

    const message: Message = {
      id: msgId || uuidv4(),
      chatId: chat.id,
      senderId,
      type: 'text',
      content: { type: 'text', text: textContent },
      timestamp: raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now(),
      status: 'delivered',
      transportUsed: transport,
    };

    await chatStore.addMessage(chat.id, message);
  }

  // ─── Отправка сообщений (каскадный выбор транспорта) ─────────────────────

  async sendTextMessage(chatId: string, recipientId: string, text: string): Promise<void> {
    if (!this.identity) throw new Error('Not initialized');

    const messageId = uuidv4();
    const { useChatStore } = require('../../store/useChatStore');
    const chatStore = useChatStore.getState();
    const bestTransport = this.getBestTransport(recipientId);

    const localMessage: Message = {
      id: messageId,
      chatId,
      senderId: this.identity.userId,
      type: 'text',
      content: { type: 'text', text },
      timestamp: Date.now(),
      status: 'sending',
      transportUsed: bestTransport,
    };
    await chatStore.addMessage(chatId, localMessage);

    const payload = JSON.stringify({ text });

    // 1. WebSocket (интернет)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'message',
        recipient_id: recipientId,
        payload,
        message_id: messageId,
      }));

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

    // 2. BLE Mesh
    try {
      const { bleTransport } = require('./BLETransport');
      if (bleTransport.isReady()) {
        const sent = await bleTransport.sendMessage({
          id: messageId,
          senderId: this.identity.userId,
          recipientId,
          payload,
          timestamp: Date.now(),
          ttl: 3,
        });
        if (sent) {
          console.log('[Pipeline] → BLE Mesh');
          this.setMessageStatus(chatId, messageId, 'sent');
          return;
        }
      }
    } catch {}

    // 3. WiFi Mesh (для SUPER_NODE)
    try {
      const { meshTransport } = require('./MeshTransport');
      if (meshTransport.isReady()) {
        const sent = await meshTransport.sendMessage({
          id: messageId,
          senderId: this.identity.userId,
          recipientId,
          payload,
          timestamp: Date.now(),
        });
        if (sent) {
          console.log('[Pipeline] → WiFi Mesh');
          this.setMessageStatus(chatId, messageId, 'sent');
          return;
        }
      }
    } catch {}

    // 4. DNS Tunnel
    try {
      const { dnsTunnel } = require('./DNSTunnel');
      if (dnsTunnel.isReady()) {
        const sent = await dnsTunnel.sendMessage(recipientId, payload);
        if (sent) {
          console.log('[Pipeline] → DNS Tunnel');
          this.setMessageStatus(chatId, messageId, 'sent');
          return;
        }
      }
    } catch {}

    // 5. HTTP store-and-forward (последний шанс)
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
      if (!res.ok) throw new Error('HTTP failed');
    } catch {
      this.setMessageStatus(chatId, messageId, 'failed');
      throw new Error('Нет подключения. Сообщение будет отправлено когда появится связь.');
    }
  }

  private getBestTransport(recipientId: string): TransportType {
    if (this.ws?.readyState === WebSocket.OPEN) return 'internet';
    
    // WiFi Mesh (для SUPER_NODE) — приоритет над BLE
    try {
      const { meshTransport } = require('./MeshTransport');
      if (meshTransport.isReady()) return 'mesh_wifi';
    } catch {}
    
    try {
      const { bleTransport } = require('./BLETransport');
      if (bleTransport.isReady() && bleTransport.hasPeer(recipientId))
        return 'mesh_ble';
    } catch {}
    
    try {
      const { dnsTunnel } = require('./DNSTunnel');
      if (dnsTunnel.isReady()) return 'dns';
    } catch {}
    return 'offline';
  }

  // ─── Инициализация всех транспортов ──────────────────────────────────────

  async initializeTransports(): Promise<void> {
    if (!this.identity) return;
    const userId = this.identity.userId;
    const name = this.displayName || userId.slice(0, 12);
    const transportStore = useTransportStore.getState();

    // BLE Mesh (новый нативный модуль — advertising + scanning + GATT в одном)
    if (transportStore.transports.mesh_ble.enabled) {
      try {
        const { bleTransport } = require('./BLETransport');
        const ok = await bleTransport.initialize(userId, name);

        if (ok) {
          bleTransport.onMessage((msg: any) => {
            this.deliverIncomingMessage({
              id: msg.id,
              sender_id: msg.senderId,
              payload: msg.payload,
              timestamp: new Date(msg.timestamp).toISOString(),
              transport: 'mesh_ble',
            });
          });
          console.log('[Pipeline] BLE Mesh ready');
        }
      } catch (err) { console.warn('[Pipeline] BLE init failed:', err); }
    }

    // WiFi Mesh (Meshrabiya) — только для SUPER_NODE
    // LEAF_NODE прозрачно использует BLE → Super Node → WiFi Mesh
    if (transportStore.transports.mesh_wifi.enabled) {
      try {
        const { meshTransport } = require('./MeshTransport');
        const ok = await meshTransport.initialize(userId, name);
        if (ok) {
          meshTransport.onMessage((msg: any) => {
            this.deliverIncomingMessage({
              id: msg.id,
              sender_id: msg.senderId,
              payload: msg.payload,
              timestamp: new Date().toISOString(),
              transport: 'mesh_wifi',
            });
          });
          console.log('[Pipeline] WiFi Mesh ready (SUPER_NODE)');
        } else {
          console.log('[Pipeline] WiFi Mesh not available (LEAF_NODE or no WiFi Aware)');
        }
      } catch (err) { console.warn('[Pipeline] WiFi Mesh init failed:', err); }
    }

    // DNS Tunnel
    if (transportStore.transports.dns.enabled) {
      try {
        const { dnsTunnel } = require('./DNSTunnel');
        const ok = await dnsTunnel.initialize(userId);
        if (ok) {
          dnsTunnel.onMessage((senderId: string, payload: string) => {
            this.deliverIncomingMessage({
              sender_id: senderId,
              payload,
              timestamp: new Date().toISOString(),
              transport: 'dns',
            });
          });
          console.log('[Pipeline] DNS Tunnel ready');
        }
      } catch (err) { console.warn('[Pipeline] DNS init failed:', err); }
    }
  }

  // ─── Утилиты ──────────────────────────────────────────────────────────────

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

    try { require('./BLETransport').bleTransport.destroy(); } catch {}
    try { require('./MeshTransport').meshTransport.destroy(); } catch {}
    try { require('./DNSTunnel').dnsTunnel.destroy(); } catch {}
  }
}

export const messagePipeline = new MessagePipeline();
