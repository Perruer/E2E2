/**
 * XAMTON BLE Mesh Transport
 * Bluetooth Low Energy mesh для связи без интернета
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { useTransportStore } from '../../store/useTransportStore';
import { v4 as uuidv4 } from 'uuid';

const XAMTON_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const XAMTON_TX_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';
const XAMTON_RX_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
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
  private peers: Map<string, BLEPeer> = new Map();
  private connectedDevices: Map<string, any> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private myUserId: string = '';
  private myDisplayName: string = '';
  private isInitialized = false;
  private scanTimer?: ReturnType<typeof setInterval>;
  private messageQueue: Map<string, BLEMessage> = new Map();

  async initialize(userId: string, displayName: string): Promise<boolean> {
    if (Platform.OS === 'web') return false;

    this.myUserId = userId;
    this.myDisplayName = displayName;

    try {
      // Запрашиваем разрешения Android
      const granted = await this.requestPermissions();
      if (!granted) {
        console.warn('[BLE] Permissions denied');
        return false;
      }

      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager();

      const state = await this.waitForBLEReady();
      if (state !== 'PoweredOn') {
        console.warn('[BLE] Bluetooth not powered on:', state);
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
        // Android 12+
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return Object.values(results).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
      } else {
        // Android < 12
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn('[BLE] Permission request error:', err);
      return false;
    }
  }

  private waitForBLEReady(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.manager) return resolve('Unknown');

      this.manager.onStateChange((state: string) => {
        if (['PoweredOn', 'PoweredOff', 'Unauthorized'].includes(state)) {
          resolve(state);
        }
      }, true);

      setTimeout(() => resolve('Unknown'), 5000);
    });
  }

  async startScanning(): Promise<void> {
    if (!this.isInitialized || this.isScanning) return;

    this.isScanning = true;
    console.log('[BLE] Starting scan...');

    try {
      this.manager.startDeviceScan(
        null, // сканируем все устройства, фильтруем по имени
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

      // Пересканируем каждые 30 секунд
      this.scanTimer = setInterval(() => {
        this.manager?.stopDeviceScan();
        this.isScanning = false;
        this.startScanning();
        this.cleanupStalePeers();
      }, 30000);

    } catch (err) {
      console.warn('[BLE] Start scan error:', err);
      this.isScanning = false;
    }
  }

  private async handleDiscoveredDevice(device: any): Promise<void> {
    const nameParts = device.name?.split(':') || [];
    if (nameParts.length < 2) return;

    const peerUserId = nameParts[1];
    const peerName = nameParts[2] || peerUserId.slice(0, 8);

    if (peerUserId === this.myUserId) return;

    const peer: BLEPeer = {
      id: device.id,
      userId: peerUserId,
      name: peerName,
      rssi: device.rssi || -100,
      lastSeen: Date.now(),
    };

    const isNew = !this.peers.has(peerUserId);
    this.peers.set(peerUserId, peer);

    if (isNew) {
      console.log('[BLE] New peer:', peerName);
      this.updateTransportStore();
      await this.connectToPeer(device, peer);
    }
  }

  private async connectToPeer(device: any, peer: BLEPeer): Promise<void> {
    if (this.connectedDevices.has(peer.userId)) return;

    try {
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

      // Отправляем очередь
      for (const [, msg] of this.messageQueue) {
        if (msg.recipientId === peer.userId) {
          await this.sendToPeer(peer.userId, msg);
          this.messageQueue.delete(msg.id);
        }
      }

      connected.onDisconnected(() => {
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
        this.messageHandlers.forEach(handler => handler(message));
        return;
      }

      // Relay через mesh
      if (message.ttl > 0 && !message.relayed) {
        this.sendMessage({ ...message, ttl: message.ttl - 1, relayed: true }).catch(() => {});
      }
    } catch (err) {
      console.warn('[BLE] Parse error:', err);
    }
  }

  async sendMessage(message: BLEMessage): Promise<boolean> {
    const device = this.connectedDevices.get(message.recipientId);

    if (!device) {
      this.messageQueue.set(message.id, message);
      // Пробуем через любой подключённый peer (mesh relay)
      for (const [, d] of this.connectedDevices) {
        try {
          await this.writeToDevice(d, message);
          return true;
        } catch {}
      }
      return false;
    }

    return this.sendToPeer(message.recipientId, message);
  }

  private async sendToPeer(userId: string, message: BLEMessage): Promise<boolean> {
    const device = this.connectedDevices.get(userId);
    if (!device) return false;
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
    const bytes = new TextEncoder().encode(JSON.stringify(message));

    for (let i = 0; i < bytes.length; i += BLE_CHUNK_SIZE) {
      const chunk = bytes.slice(i, i + BLE_CHUNK_SIZE);
      await device.writeCharacteristicWithResponseForService(
        XAMTON_SERVICE_UUID,
        XAMTON_RX_CHAR_UUID,
        encodeBase64(chunk)
      );
    }
  }

  stopScanning(): void {
    this.manager?.stopDeviceScan();
    this.isScanning = false;
    clearInterval(this.scanTimer);
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

  destroy(): void {
    this.stopScanning();
    for (const device of this.connectedDevices.values()) {
      device.cancelConnection().catch(() => {});
    }
    this.connectedDevices.clear();
    this.peers.clear();
    this.manager?.destroy();
    this.manager = null;
    this.isInitialized = false;
  }
}

export const bleTransport = new BLETransport();
