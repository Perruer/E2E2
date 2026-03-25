/**
 * XAMTON BLE Mesh Transport v3
 * Нативный модуль — без react-native-ble-plx и react-native-ble-advertiser
 * 
 * Архитектура:
 * - Каждое устройство одновременно Peripheral (GATT Server + Advertising)
 *   и Central (Scanner + GATT Client)
 * - При обнаружении другого XAMTON устройства — автоматическое подключение
 * - Handshake для обмена userId
 * - Mesh relay: сообщения с TTL > 0 пересылаются через промежуточные устройства
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { useTransportStore } from '../../store/useTransportStore';
import { v4 as uuidv4 } from 'uuid';

const { XAMTONBle } = NativeModules;
const bleEmitter = Platform.OS === 'android' && XAMTONBle
  ? new NativeEventEmitter(XAMTONBle)
  : null;

// ─── Типы ────────────────────────────────────────────────────────────────

export interface BLEPeer {
  mac: string;
  userId: string;
  role: 'central' | 'peripheral';
  rssi?: number;
  lastSeen: number;
}

export interface BLEMessage {
  id: string;
  senderId: string;
  recipientId: string;
  payload: string;
  timestamp: number;
  ttl: number;
  relayed?: boolean;
}

type MessageHandler = (message: BLEMessage) => void;

// ─── Класс ───────────────────────────────────────────────────────────────

class BLEMeshTransport {
  private peers: Map<string, BLEPeer> = new Map(); // mac → peer
  private userIdToMac: Map<string, string> = new Map(); // userId → mac
  private messageHandlers: Set<MessageHandler> = new Set();
  private myUserId = '';
  private isInitialized = false;
  private seenMessageIds: Set<string> = new Set();
  private messageQueue: Map<string, BLEMessage> = new Map();
  private listeners: Array<{ remove: () => void }> = [];
  private scanRestartTimer?: ReturnType<typeof setInterval>;

  async initialize(userId: string, _displayName: string): Promise<boolean> {
    if (this.isInitialized) return true;
    if (Platform.OS !== 'android' || !XAMTONBle || !bleEmitter) {
      console.warn('[BLE] Not available on this platform');
      return false;
    }

    this.myUserId = userId;

    try {
      await XAMTONBle.initialize(userId);
      this.setupEventListeners();
      await XAMTONBle.startAdvertising(userId);
      await XAMTONBle.startScanning();

      // Периодический рестарт сканирования (Android убивает скан через ~30 мин)
      this.scanRestartTimer = setInterval(async () => {
        try {
          await XAMTONBle.stopScanning();
          await XAMTONBle.startScanning();
          this.cleanupStalePeers();
        } catch (err) {
          console.warn('[BLE] Scan restart error:', err);
        }
      }, 5 * 60 * 1000); // каждые 5 минут

      this.isInitialized = true;
      console.log('[BLE] Mesh transport initialized');
      return true;
    } catch (err) {
      console.warn('[BLE] Init error:', err);
      return false;
    }
  }

  private setupEventListeners(): void {
    if (!bleEmitter) return;

    // Найдено новое устройство
    this.listeners.push(
      bleEmitter.addListener('onPeerDiscovered', (event: any) => {
        console.log('[BLE] Peer discovered:', event.mac, 'userId:', event.userId);
      })
    );

    // Устройство подключилось
    this.listeners.push(
      bleEmitter.addListener('onPeerConnected', (event: any) => {
        const { mac, userId, role } = event;
        console.log('[BLE] Peer connected:', mac, role, userId || '(awaiting handshake)');

        if (userId) {
          this.registerPeer(mac, userId, role);
        }
      })
    );

    // Получили userId через handshake
    this.listeners.push(
      bleEmitter.addListener('onPeerIdentified', (event: any) => {
        const { mac, userId } = event;
        console.log('[BLE] Peer identified:', mac, '→', userId);
        const existing = this.peers.get(mac);
        this.registerPeer(mac, userId, existing?.role || 'peripheral');

        // Отправляем pending сообщения этому peer'у
        this.flushQueueForUser(userId);
      })
    );

    // Устройство отключилось
    this.listeners.push(
      bleEmitter.addListener('onPeerDisconnected', (event: any) => {
        const { mac, userId } = event;
        console.log('[BLE] Peer disconnected:', mac, userId);
        this.peers.delete(mac);
        if (userId) this.userIdToMac.delete(userId);
        this.updateTransportStore();
      })
    );

    // Получено сообщение
    this.listeners.push(
      bleEmitter.addListener('onMessageReceived', (event: any) => {
        const { userId, data } = event;
        this.handleIncomingMessage(userId, data);
      })
    );

    // Advertising events (для логов)
    this.listeners.push(
      bleEmitter.addListener('onAdvertisingStarted', () => {
        console.log('[BLE] Advertising active');
      })
    );
    this.listeners.push(
      bleEmitter.addListener('onAdvertisingFailed', (event: any) => {
        console.warn('[BLE] Advertising failed:', event.errorCode);
      })
    );
  }

  private registerPeer(mac: string, userId: string, role: string): void {
    if (userId === this.myUserId) return;

    const peer: BLEPeer = {
      mac,
      userId,
      role: role as 'central' | 'peripheral',
      lastSeen: Date.now(),
    };
    this.peers.set(mac, peer);
    this.userIdToMac.set(userId, mac);
    this.updateTransportStore();
  }

  // ─── Обработка входящих сообщений ──────────────────────────────────────

  private handleIncomingMessage(fromUserId: string, rawData: string): void {
    try {
      const message: BLEMessage = JSON.parse(rawData);

      // Дедупликация
      if (this.seenMessageIds.has(message.id)) return;
      this.seenMessageIds.add(message.id);

      // Ограничиваем размер кэша
      if (this.seenMessageIds.size > 1000) {
        const arr = Array.from(this.seenMessageIds);
        this.seenMessageIds = new Set(arr.slice(-500));
      }

      // Для нас?
      if (message.recipientId === this.myUserId) {
        console.log('[BLE] Message for me from:', message.senderId);
        this.messageHandlers.forEach(h => h(message));
        return;
      }

      // Mesh relay — пересылаем если TTL > 0
      if (message.ttl > 0) {
        console.log('[BLE] Relaying message, TTL:', message.ttl);
        this.sendMessage({
          ...message,
          ttl: message.ttl - 1,
          relayed: true,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('[BLE] Parse error:', err);
    }
  }

  // ─── Отправка сообщений ────────────────────────────────────────────────

  async sendMessage(message: BLEMessage): Promise<boolean> {
    if (!this.isInitialized) return false;

    const targetMac = this.userIdToMac.get(message.recipientId);

    // Прямая отправка если peer подключён
    if (targetMac) {
      try {
        const data = JSON.stringify(message);
        await XAMTONBle.sendMessage(targetMac, data);
        console.log('[BLE] Sent directly to:', message.recipientId.slice(0, 8));
        return true;
      } catch (err) {
        console.warn('[BLE] Direct send failed:', err);
      }
    }

    // Mesh relay — отправляем всем подключённым peer'ам
    if (message.ttl > 0 && this.peers.size > 0) {
      try {
        const data = JSON.stringify(message);
        const sent = await XAMTONBle.sendToAll(data);
        if (sent > 0) {
          console.log('[BLE] Relayed to', sent, 'peers');
          return true;
        }
      } catch (err) {
        console.warn('[BLE] Relay failed:', err);
      }
    }

    // В очередь — отправим когда peer подключится
    this.messageQueue.set(message.id, message);
    return false;
  }

  private async flushQueueForUser(userId: string): Promise<void> {
    for (const [id, msg] of this.messageQueue) {
      if (msg.recipientId === userId) {
        const sent = await this.sendMessage(msg);
        if (sent) this.messageQueue.delete(id);
      }
    }
  }

  // ─── Публичный API ─────────────────────────────────────────────────────

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  getPeers(): BLEPeer[] {
    return Array.from(this.peers.values());
  }

  getPeerByUserId(userId: string): BLEPeer | undefined {
    const mac = this.userIdToMac.get(userId);
    return mac ? this.peers.get(mac) : undefined;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  hasPeer(userId: string): boolean {
    return this.userIdToMac.has(userId);
  }

  // ─── Утилиты ──────────────────────────────────────────────────────────

  private cleanupStalePeers(): void {
    const now = Date.now();
    const staleTimeout = 5 * 60 * 1000; // 5 минут

    for (const [mac, peer] of this.peers) {
      if (now - peer.lastSeen > staleTimeout) {
        this.peers.delete(mac);
        this.userIdToMac.delete(peer.userId);
      }
    }
    this.updateTransportStore();
  }

  private updateTransportStore(): void {
    const count = this.peers.size;
    useTransportStore.getState().setTransportConnected('mesh_ble', count > 0, count);
  }

  async destroy(): Promise<void> {
    clearInterval(this.scanRestartTimer);
    this.listeners.forEach(l => l.remove());
    this.listeners = [];

    if (this.isInitialized) {
      try { await XAMTONBle.stopScanning(); } catch {}
      try { await XAMTONBle.stopAdvertising(); } catch {}
      try { await XAMTONBle.disconnectAll(); } catch {}
    }

    this.peers.clear();
    this.userIdToMac.clear();
    this.messageQueue.clear();
    this.messageHandlers.clear();
    this.seenMessageIds.clear();
    this.isInitialized = false;
    useTransportStore.getState().setTransportConnected('mesh_ble', false);
  }
}

export const bleTransport = new BLEMeshTransport();
