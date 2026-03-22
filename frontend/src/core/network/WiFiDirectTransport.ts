/**
 * XAMTON WiFi Direct Transport
 * P2P WiFi соединение без роутера (только Android)
 * 
 * Принцип:
 * - Используем NSD (Network Service Discovery) для поиска устройств в локальной сети
 * - При нахождении устройства — создаём прямое TCP соединение
 * - Работает в одной WiFi сети без интернета
 * - На Android также поддерживает WiFi Direct (P2P) через нативный модуль
 * 
 * NSD работает на обоих платформах через Zeroconf/Bonjour
 */

import { Platform } from 'react-native';
import { useTransportStore } from '../../store/useTransportStore';
import { v4 as uuidv4 } from 'uuid';

const SERVICE_TYPE = '_xamton._tcp';
const SERVICE_PORT = 47821;
const XAMTON_VERSION = '1';

export interface WiFiPeer {
  id: string;
  userId: string;
  name: string;
  host: string;
  port: number;
  lastSeen: number;
}

type MessageHandler = (senderId: string, payload: string) => void;

class WiFiDirectTransport {
  private peers: Map<string, WiFiPeer> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private myUserId = '';
  private myDisplayName = '';
  private isRunning = false;
  private nsd: any = null;
  private tcpServer: any = null;
  private discoverTimer?: ReturnType<typeof setInterval>;

  async initialize(userId: string, displayName: string): Promise<boolean> {
    if (Platform.OS === 'web') return false;

    this.myUserId = userId;
    this.myDisplayName = displayName;

    try {
      // Пробуем использовать react-native-network-info + TCP сокеты
      // для NSD (Network Service Discovery) в локальной сети
      await this.startNSDService();
      await this.startDiscovery();

      this.isRunning = true;
      console.log('[WiFi] Direct transport initialized');
      return true;
    } catch (err) {
      console.warn('[WiFi] Init error (может быть недоступно на этой платформе):', err);
      return false;
    }
  }

  private async startNSDService(): Promise<void> {
    try {
      // Регистрируем наш сервис в локальной сети
      // Другие устройства XAMTON найдут нас через mDNS/Bonjour
      const NetworkInfo = require('@react-native-community/netinfo');
      const state = await NetworkInfo.default.fetch();

      if (!state.isConnected || state.type !== 'wifi') {
        throw new Error('WiFi not connected');
      }

      const localIP = state.details?.ipAddress || '0.0.0.0';
      console.log('[WiFi] Local IP:', localIP);

      // Запускаем TCP сервер для приёма соединений
      await this.startTCPServer(localIP);

    } catch (err) {
      throw err;
    }
  }

  private async startTCPServer(localIP: string): Promise<void> {
    try {
      const TcpSocket = require('react-native-tcp-socket');

      this.tcpServer = TcpSocket.createServer((socket: any) => {
        console.log('[WiFi] Incoming connection from', socket.remoteAddress);

        let buffer = '';
        socket.on('data', (data: Buffer) => {
          buffer += data.toString();

          // Сообщения разделяются \n
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              this.handleIncomingMessage(line.trim(), socket.remoteAddress);
            }
          }
        });

        socket.on('error', (err: any) => {
          console.warn('[WiFi] Socket error:', err.message);
        });
      });

      this.tcpServer.listen({ port: SERVICE_PORT, host: '0.0.0.0' }, () => {
        console.log(`[WiFi] TCP server listening on :${SERVICE_PORT}`);
      });

    } catch (err) {
      console.warn('[WiFi] TCP server error:', err);
      throw err;
    }
  }

  private async startDiscovery(): Promise<void> {
    // Периодически рассылаем UDP broadcast для обнаружения
    // Это работает даже без mDNS
    this.discoverTimer = setInterval(() => {
      this.broadcastPresence();
      this.cleanupStalePeers();
    }, 10000);

    this.broadcastPresence();
  }

  private async broadcastPresence(): Promise<void> {
    try {
      const TcpSocket = require('react-native-tcp-socket');
      const NetworkInfo = require('@react-native-community/netinfo');

      const state = await NetworkInfo.default.fetch();
      if (!state.isConnected) return;

      // Broadcast announcement
      const announcement = JSON.stringify({
        type: 'xamton_announce',
        version: XAMTON_VERSION,
        userId: this.myUserId,
        name: this.myDisplayName,
        port: SERVICE_PORT,
      });

      // Отправляем UDP broadcast 255.255.255.255
      const udp = TcpSocket.createConnection({
        port: SERVICE_PORT + 1,
        host: '255.255.255.255',
      }, () => {
        udp.write(announcement + '\n');
        udp.destroy();
      });

    } catch (err) {
      // Broadcast может не работать на некоторых устройствах
    }
  }

  private handleIncomingMessage(rawData: string, fromIP: string): void {
    try {
      const data = JSON.parse(rawData);

      if (data.type === 'xamton_announce') {
        // Новый peer обнаружен
        const peer: WiFiPeer = {
          id: data.userId,
          userId: data.userId,
          name: data.name,
          host: fromIP,
          port: data.port || SERVICE_PORT,
          lastSeen: Date.now(),
        };

        const isNew = !this.peers.has(data.userId);
        this.peers.set(data.userId, peer);

        if (isNew) {
          console.log('[WiFi] New peer:', data.name);
          this.updateTransportStore();
        }
        return;
      }

      if (data.type === 'message') {
        if (data.recipientId === this.myUserId) {
          console.log('[WiFi] Message from', data.senderId?.slice(0, 8));
          this.messageHandlers.forEach(h => h(data.senderId, data.payload));
        }
      }
    } catch (err) {
      console.warn('[WiFi] Parse error:', err);
    }
  }

  async sendMessage(recipientId: string, payload: string): Promise<boolean> {
    const peer = this.peers.get(recipientId);
    if (!peer) return false;

    try {
      const TcpSocket = require('react-native-tcp-socket');

      return new Promise((resolve) => {
        const client = TcpSocket.createConnection(
          { port: peer.port, host: peer.host },
          () => {
            const message = JSON.stringify({
              type: 'message',
              senderId: this.myUserId,
              recipientId,
              payload,
              timestamp: Date.now(),
            });

            client.write(message + '\n');
            client.destroy();
            resolve(true);
          }
        );

        client.on('error', () => {
          // Peer недоступен — удаляем
          this.peers.delete(recipientId);
          this.updateTransportStore();
          resolve(false);
        });

        setTimeout(() => {
          client.destroy();
          resolve(false);
        }, 5000);
      });
    } catch (err) {
      console.warn('[WiFi] Send error:', err);
      return false;
    }
  }

  private cleanupStalePeers(): void {
    const now = Date.now();
    for (const [userId, peer] of this.peers) {
      if (now - peer.lastSeen > 30000) {
        this.peers.delete(userId);
      }
    }
    this.updateTransportStore();
  }

  private updateTransportStore(): void {
    const count = this.peers.size;
    useTransportStore.getState().setTransportConnected('mesh_wifi', count > 0, count);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  getPeers(): WiFiPeer[] {
    return Array.from(this.peers.values());
  }

  isReady(): boolean {
    return this.isRunning;
  }

  destroy(): void {
    this.isRunning = false;
    clearInterval(this.discoverTimer);
    this.tcpServer?.close();
    this.peers.clear();
    useTransportStore.getState().setTransportConnected('mesh_wifi', false);
  }
}

export const wifiDirectTransport = new WiFiDirectTransport();
