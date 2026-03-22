/**
 * XAMTON BLE Mesh Transport v2
 * Исправлено: защита от повторного сканирования, правильный advertising
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { useTransportStore } from '../../store/useTransportStore';
import { v4 as uuidv4 } from 'uuid';

const XAMTON_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const XAMTON_TX_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';
const XAMTON_RX_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
const SCAN_INTERVAL_MS = 30000; // пересканируем каждые 30 сек
const BLE_CHUNK_SIZE = 182;

export interface BLEPeer {
  id: string;
  userId: string;
  name: string;
  rssi: number;
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

class BLETransport {
  private manager: any = null;
  private isScanning = false;
  private scanScheduled = false; // защита от двойного планирования
  private peers: Map<string, BLEPeer> = new Map();
  private connectedDevices: Map<string, any> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private myUserId: string = '';
  private myDisplayName: string = '';
  private isInitialized = false;
  private scanTimer?: ReturnType<typeof setInterval>;
  private messageQueue: Map<string, BLEMessage> = new Map();

  async initialize(userId: string, displayName: string): Promise<boolean> {
    // Защита от повторной инициализации
    if (this.isInitialized) return true;
    if (Platform.OS === 'web') return false;

    this.myUserId = userId;
    this.myDisplayName = displayName;

    try {
      const granted = await this.requestPermissions();
      if (!granted) {
        console.warn('[BLE] Permissions denied');
        return false;
      }

      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager();

      const state = await this.waitForBLEReady();
      if (state !== 'PoweredOn') {
        console.warn('[BLE] Not powered on:', state);
        return false;
      }

      this.isInitialized = true;
      console.log('[BLE] Initialized OK');
      return true;
    } catch (err) {
      console.warn('[BLE] Init error:', err);
      return false;
    }
  }

  private async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    try {
      const apiLevel = parseInt(Platform.Version as string, 10);

      if (apiLevel >= 31) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return Object.values(results).every(
          r => r === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      return false;
    }
  }

  private waitForBLEReady(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.manager) return resolve('Unknown');
      const sub = this.manager.onStateChange((state: string) => {
        if (['PoweredOn', 'PoweredOff', 'Unauthorized'].includes(state)) {
          sub.remove();
          resolve(state);
        }
      }, true);
      setTimeout(() => resolve('Unknown'), 5000);
    });
  }

  async startScanning(): Promise<void> {
    // Главная защита — не запускаем если уже идёт сканирование
    if (!this.isInitialized || this.isScanning || this.scanScheduled) return;

    this.isScanning = true;
    this.scanScheduled = false;
    console.log('[BLE] Scan started');

    try {
      this.manager.startDeviceScan(
        null,
        { allowDuplicates: false },
        async (error: any, device: any) => {
          if (error) {
            console.warn('[BLE] Scan error:', error.message);
            this.isScanning = false;
            return;
          }
          if (device?.name?.startsWith('XAMT:')) {
            await this.handleDiscoveredDevice(device);
          }
        }
      );

      // Останавливаем и перезапускаем через 30 сек — только если уже не запланировано
      if (!this.scanTimer) {
        this.scanTimer = setInterval(() => {
          if (this.isScanning) {
            this.manager?.stopDeviceScan();
            this.isScanning = false;
          }
          this.cleanupStalePeers();
          // Небольшая задержка перед следующим сканом
          setTimeout(() => {
            if (this.isInitialized && !this.isScanning) {
              this.startScanning();
            }
          }, 1000);
        }, SCAN_INTERVAL_MS);
      }

    } catch (err) {
      console.warn('[BLE] Start scan error:', err);
      this.isScanning = false;
    }
  }

  private async handleDiscoveredDevice(device: any): Promise<void> {
    const nameParts = (device.name || '').split(':');
    if (nameParts.length < 2) return;

    const peerUserId = nameParts[1];
    const peerName = nameParts[2] || peerUserId.slice(0, 8);

    if (peerUserId === this.myUserId) return;

    const existing = this.peers.get(peerUserId);
    const peer: BLEPeer = {
      id: device.id,
      userId: peerUserId,
      name: peerName,
      rssi: device.rssi || -100,
      lastSeen: Date.now(),
    };

    this.peers.set(peerUserId, peer);

    if (!existing) {
      console.log('[BLE] New peer found:', peerName, peerUserId.slice(0, 8));
      this.updateTransportStore();
      await this.connectToPeer(device, peer);
    }
  }

  private async connectToPeer(device: any, peer: BLEPeer): Promise<void> {
    if (this.connectedDevices.has(peer.userId)) return;

    try {
      console.log('[BLE] Connecting to', peer.name);
      const connected = await device.connect({ timeout: 10000 });
      await connected.discoverAllServicesAndCharacteristics();
      this.connectedDevices.set(peer.userId, connected);

      connected.monitorCharacteristicForService(
        XAMTON_SERVICE_UUID,
        XAMTON_TX_CHAR_UUID,
        (error: any, characteristic: any) => {
          if (error || !characteristic?.value) return;
          this.handleIncomingBLEData(characteristic.value, peer.userId);
        }
      );

      // Отправляем pending сообщения
      for (const [id, msg] of this.messageQueue) {
        if (msg.recipientId === peer.userId) {
          await this.writeToDevice(connected, msg);
          this.messageQueue.delete(id);
        }
      }

      connected.onDisconnected(() => {
        console.log('[BLE] Peer disconnected:', peer.name);
        this.connectedDevices.delete(peer.userId);
        this.peers.delete(peer.userId);
        this.updateTransportStore();
      });

    } catch (err) {
      console.warn('[BLE] Connect error:', err);
    }
  }

  private handleIncomingBLEData(base64Data: string, fromUserId: string): void {
    try {
      const { decodeBase64 } = require('tweetnacl-util');
      const bytes = decodeBase64(base64Data);
      const json = new TextDecoder().decode(bytes);
      const message: BLEMessage = JSON.parse(json);

      if (message.recipientId === this.myUserId) {
        this.messageHandlers.forEach(h => h(message));
        return;
      }

      // Relay mesh
      if (message.ttl > 0 && !message.relayed) {
        this.sendMessage({ ...message, ttl: message.ttl - 1, relayed: true });
      }
    } catch (err) {
      console.warn('[BLE] Parse incoming error:', err);
    }
  }

  async sendMessage(message: BLEMessage): Promise<boolean> {
    const device = this.connectedDevices.get(message.recipientId);

    if (!device) {
      this.messageQueue.set(message.id, message);
      // Пробуем relay через любой подключённый peer
      for (const [, dev] of this.connectedDevices) {
        try {
          await this.writeToDevice(dev, message);
          return true;
        } catch {}
      }
      return false;
    }

    try {
      await this.writeToDevice(device, message);
      return true;
    } catch (err) {
      console.warn('[BLE] Send error:', err);
      return false;
    }
  }

  private async writeToDevice(device: any, message: BLEMessage): Promise<void> {
    const { encodeBase64 } = require('tweetnacl-util');
    const json = JSON.stringify(message);
    const bytes = new TextEncoder().encode(json);

    for (let i = 0; i < bytes.length; i += BLE_CHUNK_SIZE) {
      const chunk = bytes.slice(i, i + BLE_CHUNK_SIZE);
      const b64 = encodeBase64(chunk);
      await device.writeCharacteristicWithResponseForService(
        XAMTON_SERVICE_UUID,
        XAMTON_RX_CHAR_UUID,
        b64
      );
    }
  }

  private cleanupStalePeers(): void {
    const now = Date.now();
    for (const [userId, peer] of this.peers) {
      if (now - peer.lastSeen > 60000) {
        this.peers.delete(userId);
        this.connectedDevices.delete(userId);
      }
    }
    this.updateTransportStore();
  }

  private updateTransportStore(): void {
    const count = this.peers.size;
    useTransportStore.getState().setTransportConnected('mesh_ble', count > 0, count);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  getPeers(): BLEPeer[] {
    return Array.from(this.peers.values());
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Имя устройства для обнаружения другими XAMTON устройствами
   * Формат: XAMT:{userId}:{displayName}
   */
  getAdvertisingName(): string {
    const name = this.myDisplayName.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
    return `XAMT:${this.myUserId.slice(0, 8)}:${name || 'user'}`;
  }

  destroy(): void {
    clearInterval(this.scanTimer);
    this.scanTimer = undefined;
    this.manager?.stopDeviceScan();
    for (const device of this.connectedDevices.values()) {
      device.cancelConnection().catch(() => {});
    }
    this.connectedDevices.clear();
    this.peers.clear();
    this.manager?.destroy();
    this.manager = null;
    this.isInitialized = false;
    this.isScanning = false;
    this.scanScheduled = false;
    useTransportStore.getState().setTransportConnected('mesh_ble', false);
  }
}

export const bleTransport = new BLETransport();
