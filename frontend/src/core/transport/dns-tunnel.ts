/**
 * XAMTON DNS Tunneling Transport
 * Передача данных через DNS запросы
 * 
 * Принцип работы:
 * 1. Данные кодируются в base32 и разбиваются на чанки
 * 2. Каждый чанк становится поддоменом: <chunk>.tunnel.domain.com
 * 3. DNS сервер декодирует и собирает данные
 * 4. Ответ приходит в TXT записи
 */

import { BaseTransport } from './base';
import {
  TransportType,
  TransportMessage,
  TransportResult,
  DNSTunnelConfig,
  DNSQuery,
} from './types';

// Base32 алфавит (DNS-safe)
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export class DNSTunnelTransport extends BaseTransport {
  readonly type: TransportType = 'dns';
  private config: DNSTunnelConfig | null = null;
  private pendingQueries: Map<string, { resolve: Function; reject: Function }> = new Map();

  async initialize(config: DNSTunnelConfig): Promise<void> {
    this.config = {
      domain: config.domain,
      dnsServer: config.dnsServer,
      chunkSize: config.chunkSize || 63, // Max subdomain length
      queryType: config.queryType || 'TXT',
    };
    this.stats.type = 'dns';
    this._status = 'disabled';
  }

  async connect(): Promise<boolean> {
    if (!this.config) {
      throw new Error('DNS Tunnel not initialized');
    }

    try {
      this._status = 'connecting';
      
      // Проверяем доступность DNS сервера
      const testQuery = this.createQuery('ping', this.config.domain);
      const response = await this.sendDNSQuery(testQuery);
      
      if (response) {
        this._status = 'connected';
        return true;
      }
      
      this._status = 'error';
      return false;
    } catch (error) {
      this._status = 'error';
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.pendingQueries.clear();
    this._status = 'disabled';
  }

  async send(message: TransportMessage): Promise<TransportResult> {
    if (!this.config || this._status !== 'connected') {
      return {
        success: false,
        transportUsed: 'dns',
        error: 'DNS Tunnel not connected',
      };
    }

    const startTime = Date.now();

    try {
      // Кодируем payload в base32
      const encoded = this.encodeBase32(message.payload);
      
      // Разбиваем на чанки
      const chunks = this.splitIntoChunks(encoded, this.config.chunkSize);
      
      // Создаём сессию для многочастного сообщения
      const sessionId = message.id.slice(0, 8);
      const totalChunks = chunks.length;
      
      // Отправляем каждый чанк как DNS запрос
      for (let i = 0; i < chunks.length; i++) {
        const subdomain = `${sessionId}-${i}-${totalChunks}-${chunks[i]}`;
        const query = this.createQuery(subdomain, this.config.domain);
        
        await this.sendDNSQuery(query);
      }

      const latency = Date.now() - startTime;
      this.updateStats(message.payload.length, latency);

      return {
        success: true,
        transportUsed: 'dns',
        messageId: message.id,
        latency,
      };
    } catch (error) {
      return {
        success: false,
        transportUsed: 'dns',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Создаёт DNS запрос
   */
  private createQuery(subdomain: string, domain: string): DNSQuery {
    return {
      subdomain: subdomain.toLowerCase(),
      domain,
      queryType: this.config?.queryType || 'TXT',
    };
  }

  /**
   * Отправляет DNS запрос
   * В реальной реализации использует DNS-over-HTTPS или нативный DNS
   */
  private async sendDNSQuery(query: DNSQuery): Promise<string | null> {
    // Используем DNS-over-HTTPS (DoH) через публичные резолверы
    const dohUrl = `https://dns.google/resolve?name=${query.subdomain}.${query.domain}&type=${query.queryType}`;
    
    try {
      const response = await fetch(dohUrl);
      const data = await response.json();
      
      if (data.Answer && data.Answer.length > 0) {
        return data.Answer[0].data;
      }
      
      return null;
    } catch (error) {
      console.error('DNS query failed:', error);
      return null;
    }
  }

  /**
   * Кодирует данные в Base32 (DNS-safe)
   */
  private encodeBase32(data: Uint8Array): string {
    let result = '';
    let buffer = 0;
    let bitsLeft = 0;

    for (const byte of data) {
      buffer = (buffer << 8) | byte;
      bitsLeft += 8;

      while (bitsLeft >= 5) {
        bitsLeft -= 5;
        result += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
      }
    }

    if (bitsLeft > 0) {
      result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
    }

    return result;
  }

  /**
   * Декодирует данные из Base32
   */
  private decodeBase32(encoded: string): Uint8Array {
    const result: number[] = [];
    let buffer = 0;
    let bitsLeft = 0;

    for (const char of encoded.toLowerCase()) {
      const value = BASE32_ALPHABET.indexOf(char);
      if (value === -1) continue;

      buffer = (buffer << 5) | value;
      bitsLeft += 5;

      if (bitsLeft >= 8) {
        bitsLeft -= 8;
        result.push((buffer >> bitsLeft) & 0xff);
      }
    }

    return new Uint8Array(result);
  }

  /**
   * Разбивает строку на чанки
   */
  private splitIntoChunks(str: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += chunkSize) {
      chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// Экспорт singleton
export const dnsTunnelTransport = new DNSTunnelTransport();
