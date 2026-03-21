/**
 * XAMTON Transport Types
 * Типы для мультитранспортной архитектуры
 */

export type TransportType = 'direct' | 'dns' | 'domain_fronting' | 'steganography' | 'mesh_ble' | 'mesh_wifi';

export type TransportStatus = 'disabled' | 'connecting' | 'connected' | 'error';

export interface TransportConfig {
  type: TransportType;
  enabled: boolean;
  priority: number; // Меньше = выше приоритет
  config: Record<string, any>;
}

export interface TransportMessage {
  id: string;
  payload: Uint8Array; // Зашифрованные данные
  recipientId: string;
  timestamp: number;
  ttl: number; // Время жизни в секундах
}

export interface TransportResult {
  success: boolean;
  transportUsed: TransportType;
  messageId?: string;
  error?: string;
  latency?: number;
}

export interface TransportStats {
  type: TransportType;
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  averageLatency: number;
  lastUsed?: number;
}

/**
 * Базовый интерфейс транспорта
 * Все транспорты должны реализовывать этот интерфейс
 */
export interface ITransport {
  readonly type: TransportType;
  readonly status: TransportStatus;
  
  // Жизненный цикл
  initialize(config: Record<string, any>): Promise<void>;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  
  // Отправка/получение
  send(message: TransportMessage): Promise<TransportResult>;
  onMessage(callback: (message: TransportMessage) => void): void;
  
  // Статистика
  getStats(): TransportStats;
}

/**
 * DNS Tunneling специфичные типы
 */
export interface DNSTunnelConfig {
  domain: string; // Домен для туннелирования
  dnsServer?: string; // DNS сервер (опционально)
  chunkSize: number; // Размер чанка данных в DNS запросе
  queryType: 'TXT' | 'CNAME' | 'NULL'; // Тип DNS записи
}

export interface DNSQuery {
  subdomain: string; // Закодированные данные
  domain: string;
  queryType: string;
}

/**
 * Domain Fronting специфичные типы
 */
export interface DomainFrontingConfig {
  frontDomain: string; // Публичный домен (например, cdn.example.com)
  realHost: string; // Реальный хост в Host заголовке
  cdnProvider: 'cloudflare' | 'fastly' | 'azure' | 'custom';
}

/**
 * Steganography специфичные типы
 */
export interface SteganographyConfig {
  platform: 'vk' | 'telegram' | 'http';
  apiToken?: string;
  bitsPerChannel: 1 | 2 | 4; // Количество бит на цветовой канал
  useAlphaChannel: boolean;
}

export interface StegoImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA данные
  capacity: number; // Максимальное количество байт для сокрытия
}

export interface StegoMessage {
  data: Uint8Array;
  checksum: number;
  timestamp: number;
}
