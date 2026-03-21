/**
 * XAMTON Domain Fronting Transport
 * Маскировка трафика через CDN
 * 
 * Принцип работы:
 * 1. TLS соединение устанавливается с CDN (SNI: cdn.allowed-domain.com)
 * 2. HTTP Host заголовок указывает на реальный сервер (Host: real.xamton.com)
 * 3. CDN проксирует запрос на реальный сервер
 * 4. Для DPI виден только трафик к разрешённому CDN домену
 * 
 * ВАЖНО: Большинство CDN заблокировали эту технику в 2018-2019
 * Этот код представляет архитектуру для совместимых CDN
 */

import { BaseTransport } from './base';
import {
  TransportType,
  TransportMessage,
  TransportResult,
  DomainFrontingConfig,
} from './types';

export class DomainFrontingTransport extends BaseTransport {
  readonly type: TransportType = 'domain_fronting';
  private config: DomainFrontingConfig | null = null;

  async initialize(config: DomainFrontingConfig): Promise<void> {
    this.config = {
      frontDomain: config.frontDomain,
      realHost: config.realHost,
      cdnProvider: config.cdnProvider || 'custom',
    };
    this.stats.type = 'domain_fronting';
    this._status = 'disabled';
  }

  async connect(): Promise<boolean> {
    if (!this.config) {
      throw new Error('Domain Fronting not initialized');
    }

    try {
      this._status = 'connecting';
      
      // Проверяем доступность front domain
      const testUrl = `https://${this.config.frontDomain}/health`;
      const response = await this.sendFrontedRequest(testUrl, 'GET', null);
      
      if (response.ok) {
        this._status = 'connected';
        return true;
      }
      
      this._status = 'error';
      return false;
    } catch (error) {
      console.warn('Domain Fronting connection failed:', error);
      this._status = 'error';
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this._status = 'disabled';
  }

  async send(message: TransportMessage): Promise<TransportResult> {
    if (!this.config || this._status !== 'connected') {
      return {
        success: false,
        transportUsed: 'domain_fronting',
        error: 'Domain Fronting not connected',
      };
    }

    const startTime = Date.now();

    try {
      // Формируем URL с front domain
      const url = `https://${this.config.frontDomain}/api/message`;
      
      // Кодируем payload в base64
      const payload = this.arrayBufferToBase64(message.payload);
      
      const body = JSON.stringify({
        id: message.id,
        recipient: message.recipientId,
        payload,
        timestamp: message.timestamp,
        ttl: message.ttl,
      });

      const response = await this.sendFrontedRequest(url, 'POST', body);

      const latency = Date.now() - startTime;
      
      if (response.ok) {
        this.updateStats(message.payload.length, latency);
        return {
          success: true,
          transportUsed: 'domain_fronting',
          messageId: message.id,
          latency,
        };
      }

      return {
        success: false,
        transportUsed: 'domain_fronting',
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        transportUsed: 'domain_fronting',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Отправляет запрос с Domain Fronting
   * SNI будет front domain, но Host заголовок - real host
   */
  private async sendFrontedRequest(
    url: string,
    method: string,
    body: string | null
  ): Promise<Response> {
    if (!this.config) {
      throw new Error('Not configured');
    }

    // ВАЖНО: В браузере/React Native нельзя напрямую манипулировать SNI
    // Это работает только с нативным кодом или специальными библиотеками
    // Здесь мы устанавливаем Host заголовок, но SNI контролируется системой
    
    const headers: Record<string, string> = {
      'Host': this.config.realHost, // Реальный хост
      'Content-Type': 'application/json',
      'X-Forwarded-Host': this.config.realHost,
    };

    // Добавляем специфичные заголовки для разных CDN
    switch (this.config.cdnProvider) {
      case 'cloudflare':
        headers['CF-Connecting-IP'] = '127.0.0.1';
        break;
      case 'fastly':
        headers['Fastly-Client-IP'] = '127.0.0.1';
        break;
      case 'azure':
        headers['X-Azure-ClientIP'] = '127.0.0.1';
        break;
    }

    return fetch(url, {
      method,
      headers,
      body: body || undefined,
    });
  }

  /**
   * Конвертирует Uint8Array в Base64
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }

  /**
   * Проверяет поддержку Domain Fronting для данного CDN
   */
  static async checkSupport(frontDomain: string, realHost: string): Promise<boolean> {
    try {
      const response = await fetch(`https://${frontDomain}/`, {
        method: 'HEAD',
        headers: {
          'Host': realHost,
        },
      });
      
      // Если ответ 421 (Misdirected Request), CDN не поддерживает domain fronting
      return response.status !== 421;
    } catch {
      return false;
    }
  }
}

// Экспорт singleton
export const domainFrontingTransport = new DomainFrontingTransport();
