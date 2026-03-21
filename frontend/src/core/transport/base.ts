/**
 * XAMTON Base Transport
 * Базовый класс для всех транспортов
 */

import {
  ITransport,
  TransportType,
  TransportStatus,
  TransportMessage,
  TransportResult,
  TransportStats,
} from './types';

export abstract class BaseTransport implements ITransport {
  abstract readonly type: TransportType;
  protected _status: TransportStatus = 'disabled';
  protected messageCallback?: (message: TransportMessage) => void;
  protected stats: TransportStats;

  constructor() {
    this.stats = {
      type: 'direct' as TransportType,
      messagesSent: 0,
      messagesReceived: 0,
      bytesTransferred: 0,
      averageLatency: 0,
    };
  }

  get status(): TransportStatus {
    return this._status;
  }

  abstract initialize(config: Record<string, any>): Promise<void>;
  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract send(message: TransportMessage): Promise<TransportResult>;

  onMessage(callback: (message: TransportMessage) => void): void {
    this.messageCallback = callback;
  }

  getStats(): TransportStats {
    return { ...this.stats };
  }

  protected updateStats(bytesSent: number, latency: number): void {
    this.stats.messagesSent++;
    this.stats.bytesTransferred += bytesSent;
    this.stats.lastUsed = Date.now();
    
    // Скользящее среднее для latency
    const n = this.stats.messagesSent;
    this.stats.averageLatency = 
      (this.stats.averageLatency * (n - 1) + latency) / n;
  }

  protected emitMessage(message: TransportMessage): void {
    this.stats.messagesReceived++;
    this.stats.bytesTransferred += message.payload.length;
    this.messageCallback?.(message);
  }
}
