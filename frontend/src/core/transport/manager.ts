/**
 * XAMTON Transport Manager
 * Управление всеми транспортами и автоматический выбор оптимального
 */

import {
  ITransport,
  TransportType,
  TransportConfig,
  TransportMessage,
  TransportResult,
} from './types';
import { dnsTunnelTransport } from './dns-tunnel';
import { domainFrontingTransport } from './domain-fronting';
import { steganographyTransport } from './steganography';

// Приоритет транспортов (меньше = выше приоритет)
const DEFAULT_PRIORITY: Record<TransportType, number> = {
  direct: 1,
  domain_fronting: 2,
  dns: 3,
  steganography: 4,
  mesh_wifi: 5,
  mesh_ble: 6,
};

export class TransportManager {
  private transports: Map<TransportType, ITransport> = new Map();
  private configs: Map<TransportType, TransportConfig> = new Map();
  private messageCallbacks: Set<(message: TransportMessage, transport: TransportType) => void> = new Set();

  constructor() {
    // Регистрируем доступные транспорты
    this.transports.set('dns', dnsTunnelTransport);
    this.transports.set('domain_fronting', domainFrontingTransport);
    this.transports.set('steganography', steganographyTransport);
  }

  /**
   * Инициализирует транспорт с конфигурацией
   */
  async initializeTransport(config: TransportConfig): Promise<boolean> {
    const transport = this.transports.get(config.type);
    if (!transport) {
      console.warn(`Transport ${config.type} not available`);
      return false;
    }

    try {
      await transport.initialize(config.config);
      this.configs.set(config.type, config);
      
      // Подписываемся на входящие сообщения
      transport.onMessage((message) => {
        this.emitMessage(message, config.type);
      });
      
      return true;
    } catch (error) {
      console.error(`Failed to initialize ${config.type}:`, error);
      return false;
    }
  }

  /**
   * Подключает транспорт
   */
  async connectTransport(type: TransportType): Promise<boolean> {
    const transport = this.transports.get(type);
    if (!transport) return false;
    
    return transport.connect();
  }

  /**
   * Отключает транспорт
   */
  async disconnectTransport(type: TransportType): Promise<void> {
    const transport = this.transports.get(type);
    if (transport) {
      await transport.disconnect();
    }
  }

  /**
   * Отправляет сообщение через оптимальный транспорт
   */
  async send(message: TransportMessage, preferredTransport?: TransportType): Promise<TransportResult> {
    // Если указан предпочтительный транспорт, пробуем его сначала
    if (preferredTransport) {
      const result = await this.sendVia(message, preferredTransport);
      if (result.success) return result;
    }

    // Получаем список включённых транспортов, отсортированных по приоритету
    const availableTransports = this.getAvailableTransports();
    
    // Пробуем каждый транспорт по очереди
    for (const type of availableTransports) {
      if (type === preferredTransport) continue; // Уже пробовали
      
      const result = await this.sendVia(message, type);
      if (result.success) return result;
    }

    return {
      success: false,
      transportUsed: 'direct',
      error: 'All transports failed',
    };
  }

  /**
   * Отправляет через конкретный транспорт
   */
  private async sendVia(message: TransportMessage, type: TransportType): Promise<TransportResult> {
    const transport = this.transports.get(type);
    if (!transport || transport.status !== 'connected') {
      return {
        success: false,
        transportUsed: type,
        error: `Transport ${type} not available`,
      };
    }

    return transport.send(message);
  }

  /**
   * Возвращает список доступных транспортов, отсортированных по приоритету
   */
  private getAvailableTransports(): TransportType[] {
    const available: { type: TransportType; priority: number }[] = [];
    
    for (const [type, config] of this.configs) {
      if (config.enabled) {
        const transport = this.transports.get(type);
        if (transport && transport.status === 'connected') {
          available.push({
            type,
            priority: config.priority ?? DEFAULT_PRIORITY[type] ?? 999,
          });
        }
      }
    }
    
    return available
      .sort((a, b) => a.priority - b.priority)
      .map(t => t.type);
  }

  /**
   * Подписка на входящие сообщения
   */
  onMessage(callback: (message: TransportMessage, transport: TransportType) => void): void {
    this.messageCallbacks.add(callback);
  }

  /**
   * Отписка от входящих сообщений
   */
  offMessage(callback: (message: TransportMessage, transport: TransportType) => void): void {
    this.messageCallbacks.delete(callback);
  }

  private emitMessage(message: TransportMessage, transport: TransportType): void {
    for (const callback of this.messageCallbacks) {
      callback(message, transport);
    }
  }

  /**
   * Получает статистику всех транспортов
   */
  getAllStats() {
    const stats: Record<string, any> = {};
    
    for (const [type, transport] of this.transports) {
      stats[type] = {
        status: transport.status,
        ...transport.getStats(),
      };
    }
    
    return stats;
  }

  /**
   * Проверяет доступность всех транспортов
   */
  async probeAllTransports(): Promise<Record<TransportType, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const [type, transport] of this.transports) {
      const config = this.configs.get(type);
      if (config?.enabled) {
        results[type] = await transport.connect();
      } else {
        results[type] = false;
      }
    }
    
    return results as Record<TransportType, boolean>;
  }
}

// Singleton
export const transportManager = new TransportManager();
