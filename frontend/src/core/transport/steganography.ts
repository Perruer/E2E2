/**
 * XAMTON Steganography Transport
 * Сокрытие данных в изображениях (LSB метод)
 * 
 * Принцип работы:
 * 1. Данные кодируются в младшие биты (LSB) пикселей изображения
 * 2. Изображение визуально неотличимо от оригинала
 * 3. Транспорт через VK/Telegram/HTTP
 */

import { BaseTransport } from './base';
import {
  TransportType,
  TransportMessage,
  TransportResult,
  SteganographyConfig,
  StegoImage,
  StegoMessage,
} from './types';

// Магическое число для идентификации стего-сообщений
const STEGO_MAGIC = 0x584D544E; // 'XMTN' in hex

export class SteganographyEngine {
  private bitsPerChannel: number;
  private useAlpha: boolean;

  constructor(bitsPerChannel: 1 | 2 | 4 = 2, useAlpha: boolean = false) {
    this.bitsPerChannel = bitsPerChannel;
    this.useAlpha = useAlpha;
  }

  /**
   * Вычисляет максимальную ёмкость изображения
   */
  calculateCapacity(width: number, height: number): number {
    const pixelCount = width * height;
    const channelsPerPixel = this.useAlpha ? 4 : 3; // RGB или RGBA
    const bitsPerPixel = channelsPerPixel * this.bitsPerChannel;
    const totalBits = pixelCount * bitsPerPixel;
    
    // Вычитаем заголовок (magic + length + checksum)
    const headerBits = (4 + 4 + 4) * 8;
    
    return Math.floor((totalBits - headerBits) / 8);
  }

  /**
   * Кодирует данные в изображение (LSB)
   */
  encode(imageData: Uint8Array, width: number, height: number, data: Uint8Array): Uint8Array {
    const capacity = this.calculateCapacity(width, height);
    
    if (data.length > capacity) {
      throw new Error(`Data too large: ${data.length} bytes, capacity: ${capacity} bytes`);
    }

    // Создаём копию данных изображения
    const result = new Uint8Array(imageData);
    
    // Формируем заголовок: magic (4) + length (4) + checksum (4)
    const header = new Uint8Array(12);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, STEGO_MAGIC, false); // Big-endian
    headerView.setUint32(4, data.length, false);
    headerView.setUint32(8, this.calculateChecksum(data), false);
    
    // Объединяем заголовок и данные
    const payload = new Uint8Array(header.length + data.length);
    payload.set(header, 0);
    payload.set(data, header.length);
    
    // Кодируем в LSB
    let bitIndex = 0;
    const mask = (1 << this.bitsPerChannel) - 1;
    const invMask = ~mask;
    
    for (let i = 0; i < result.length && bitIndex < payload.length * 8; i++) {
      // Пропускаем альфа-канал если не используем
      if (!this.useAlpha && (i % 4 === 3)) continue;
      
      // Извлекаем биты из payload
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      let bits = 0;
      for (let b = 0; b < this.bitsPerChannel; b++) {
        const currentBitIndex = bitIndex + b;
        const currentByteIndex = Math.floor(currentBitIndex / 8);
        const currentBitOffset = 7 - (currentBitIndex % 8);
        
        if (currentByteIndex < payload.length) {
          const bit = (payload[currentByteIndex] >> currentBitOffset) & 1;
          bits = (bits << 1) | bit;
        }
      }
      
      // Записываем в младшие биты пикселя
      result[i] = (result[i] & invMask) | bits;
      bitIndex += this.bitsPerChannel;
    }
    
    return result;
  }

  /**
   * Декодирует данные из изображения
   */
  decode(imageData: Uint8Array, width: number, height: number): Uint8Array | null {
    // Сначала читаем заголовок
    const headerBits = 12 * 8;
    const header = this.extractBits(imageData, 0, headerBits);
    
    const headerView = new DataView(header.buffer);
    const magic = headerView.getUint32(0, false);
    
    if (magic !== STEGO_MAGIC) {
      return null; // Нет стего-данных
    }
    
    const dataLength = headerView.getUint32(4, false);
    const storedChecksum = headerView.getUint32(8, false);
    
    // Проверяем разумность длины
    const capacity = this.calculateCapacity(width, height);
    if (dataLength > capacity || dataLength === 0) {
      return null;
    }
    
    // Извлекаем данные
    const data = this.extractBits(imageData, headerBits, dataLength * 8);
    
    // Проверяем контрольную сумму
    const calculatedChecksum = this.calculateChecksum(data);
    if (calculatedChecksum !== storedChecksum) {
      console.warn('Checksum mismatch in stego data');
      return null;
    }
    
    return data;
  }

  /**
   * Извлекает биты из изображения
   */
  private extractBits(imageData: Uint8Array, startBit: number, bitCount: number): Uint8Array {
    const result = new Uint8Array(Math.ceil(bitCount / 8));
    const mask = (1 << this.bitsPerChannel) - 1;
    
    let bitIndex = 0;
    let pixelIndex = 0;
    
    // Пропускаем до стартовой позиции
    let bitsToSkip = startBit;
    while (bitsToSkip > 0 && pixelIndex < imageData.length) {
      if (!this.useAlpha && (pixelIndex % 4 === 3)) {
        pixelIndex++;
        continue;
      }
      const skip = Math.min(bitsToSkip, this.bitsPerChannel);
      bitsToSkip -= skip;
      if (bitsToSkip === 0) {
        // Частичное чтение из текущего пикселя
        break;
      }
      pixelIndex++;
    }
    
    // Извлекаем биты
    let resultBitIndex = 0;
    while (resultBitIndex < bitCount && pixelIndex < imageData.length) {
      if (!this.useAlpha && (pixelIndex % 4 === 3)) {
        pixelIndex++;
        continue;
      }
      
      const bits = imageData[pixelIndex] & mask;
      
      for (let b = this.bitsPerChannel - 1; b >= 0 && resultBitIndex < bitCount; b--) {
        const bit = (bits >> b) & 1;
        const byteIndex = Math.floor(resultBitIndex / 8);
        const bitOffset = 7 - (resultBitIndex % 8);
        result[byteIndex] |= bit << bitOffset;
        resultBitIndex++;
      }
      
      pixelIndex++;
    }
    
    return result;
  }

  /**
   * Вычисляет контрольную сумму (CRC32-like)
   */
  private calculateChecksum(data: Uint8Array): number {
    let checksum = 0xFFFFFFFF;
    
    for (const byte of data) {
      checksum ^= byte;
      for (let i = 0; i < 8; i++) {
        if (checksum & 1) {
          checksum = (checksum >>> 1) ^ 0xEDB88320;
        } else {
          checksum >>>= 1;
        }
      }
    }
    
    return checksum ^ 0xFFFFFFFF;
  }
}

export class SteganographyTransport extends BaseTransport {
  readonly type: TransportType = 'steganography';
  private config: SteganographyConfig | null = null;
  private engine: SteganographyEngine | null = null;

  async initialize(config: SteganographyConfig): Promise<void> {
    this.config = {
      platform: config.platform || 'vk',
      apiToken: config.apiToken,
      bitsPerChannel: config.bitsPerChannel || 2,
      useAlphaChannel: config.useAlphaChannel || false,
    };
    
    this.engine = new SteganographyEngine(
      this.config.bitsPerChannel,
      this.config.useAlphaChannel
    );
    
    this.stats.type = 'steganography';
    this._status = 'disabled';
  }

  async connect(): Promise<boolean> {
    if (!this.config) {
      throw new Error('Steganography not initialized');
    }

    this._status = 'connecting';
    
    // Проверяем доступность платформы
    try {
      switch (this.config.platform) {
        case 'vk':
          if (!this.config.apiToken) {
            this._status = 'error';
            return false;
          }
          // Проверяем VK API
          const vkOk = await this.checkVKConnection();
          this._status = vkOk ? 'connected' : 'error';
          return vkOk;
          
        case 'http':
          this._status = 'connected';
          return true;
          
        default:
          this._status = 'error';
          return false;
      }
    } catch (error) {
      this._status = 'error';
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this._status = 'disabled';
  }

  async send(message: TransportMessage): Promise<TransportResult> {
    if (!this.config || !this.engine || this._status !== 'connected') {
      return {
        success: false,
        transportUsed: 'steganography',
        error: 'Steganography not connected',
      };
    }

    const startTime = Date.now();

    try {
      // Создаём или загружаем изображение-контейнер
      const container = await this.getContainerImage();
      
      // Кодируем сообщение в изображение
      const stegoData = this.engine.encode(
        container.data,
        container.width,
        container.height,
        message.payload
      );
      
      // Отправляем через выбранную платформу
      let uploadResult: { success: boolean; url?: string; error?: string };
      
      switch (this.config.platform) {
        case 'vk':
          uploadResult = await this.uploadToVK(stegoData, container.width, container.height);
          break;
        case 'http':
          uploadResult = await this.uploadToHTTP(stegoData, container.width, container.height);
          break;
        default:
          uploadResult = { success: false, error: 'Unknown platform' };
      }

      const latency = Date.now() - startTime;

      if (uploadResult.success) {
        this.updateStats(message.payload.length, latency);
        return {
          success: true,
          transportUsed: 'steganography',
          messageId: message.id,
          latency,
        };
      }

      return {
        success: false,
        transportUsed: 'steganography',
        error: uploadResult.error,
      };
    } catch (error) {
      return {
        success: false,
        transportUsed: 'steganography',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Получает изображение-контейнер
   */
  private async getContainerImage(): Promise<StegoImage> {
    // Генерируем случайное изображение с шумом
    // В реальности лучше использовать настоящую фотографию
    const width = 1024;
    const height = 1024;
    const data = new Uint8Array(width * height * 4);
    
    // Заполняем случайными значениями (имитация фото)
    for (let i = 0; i < data.length; i += 4) {
      // Создаём градиент с шумом
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);
      
      const baseR = Math.floor((x / width) * 200) + 30;
      const baseG = Math.floor((y / height) * 200) + 30;
      const baseB = Math.floor(((x + y) / (width + height)) * 200) + 30;
      
      // Добавляем шум
      data[i] = Math.min(255, Math.max(0, baseR + Math.floor(Math.random() * 30 - 15)));
      data[i + 1] = Math.min(255, Math.max(0, baseG + Math.floor(Math.random() * 30 - 15)));
      data[i + 2] = Math.min(255, Math.max(0, baseB + Math.floor(Math.random() * 30 - 15)));
      data[i + 3] = 255; // Alpha
    }
    
    return {
      width,
      height,
      data,
      capacity: this.engine!.calculateCapacity(width, height),
    };
  }

  /**
   * Проверяет соединение с VK API
   */
  private async checkVKConnection(): Promise<boolean> {
    if (!this.config?.apiToken) return false;
    
    try {
      const response = await fetch(
        `https://api.vk.com/method/users.get?access_token=${this.config.apiToken}&v=5.131`
      );
      const data = await response.json();
      return !data.error;
    } catch {
      return false;
    }
  }

  /**
   * Загружает стего-изображение в VK
   */
  private async uploadToVK(
    imageData: Uint8Array,
    width: number,
    height: number
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!this.config?.apiToken) {
      return { success: false, error: 'No VK API token' };
    }

    try {
      // 1. Получаем URL для загрузки
      const uploadServerResponse = await fetch(
        `https://api.vk.com/method/photos.getWallUploadServer?access_token=${this.config.apiToken}&v=5.131`
      );
      const uploadServerData = await uploadServerResponse.json();
      
      if (uploadServerData.error) {
        return { success: false, error: uploadServerData.error.error_msg };
      }
      
      const uploadUrl = uploadServerData.response.upload_url;
      
      // 2. Конвертируем RGBA в PNG
      const pngData = this.rgbaToPNG(imageData, width, height);
      
      // 3. Загружаем изображение
      const formData = new FormData();
      const blob = new Blob([pngData], { type: 'image/png' });
      formData.append('photo', blob, 'stego.png');
      
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });
      const uploadResult = await uploadResponse.json();
      
      if (!uploadResult.photo) {
        return { success: false, error: 'Upload failed' };
      }
      
      // 4. Сохраняем фото
      const saveResponse = await fetch(
        `https://api.vk.com/method/photos.saveWallPhoto?` +
        `access_token=${this.config.apiToken}&v=5.131&` +
        `photo=${encodeURIComponent(uploadResult.photo)}&` +
        `server=${uploadResult.server}&` +
        `hash=${uploadResult.hash}`
      );
      const saveData = await saveResponse.json();
      
      if (saveData.error) {
        return { success: false, error: saveData.error.error_msg };
      }
      
      const photo = saveData.response[0];
      const photoUrl = photo.sizes[photo.sizes.length - 1].url;
      
      return { success: true, url: photoUrl };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'VK upload failed',
      };
    }
  }

  /**
   * Загружает через HTTP на собственный сервер
   */
  private async uploadToHTTP(
    imageData: Uint8Array,
    width: number,
    height: number
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    // Placeholder для HTTP транспорта
    return { success: false, error: 'HTTP transport not implemented' };
  }

  /**
   * Простая конвертация RGBA в PNG
   * В реальности нужна полноценная PNG библиотека
   */
  private rgbaToPNG(rgba: Uint8Array, width: number, height: number): Uint8Array {
    // Это упрощённая реализация
    // Для production нужно использовать библиотеку типа pngjs
    
    // Создаём заголовок PNG
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    
    // Возвращаем RGBA как есть (в реальности нужен полноценный PNG encoder)
    // Для демонстрации возвращаем raw данные
    return rgba;
  }

  /**
   * Извлекает сообщение из изображения
   */
  async extractFromImage(imageData: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
    if (!this.engine) {
      return null;
    }
    return this.engine.decode(imageData, width, height);
  }
}

// Экспорт
export const steganographyTransport = new SteganographyTransport();
export { SteganographyEngine };
