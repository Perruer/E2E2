/**
 * XAMTON DNS Tunnel Transport
 * Передача сообщений через DNS запросы когда TCP/HTTP заблокирован
 * 
 * Принцип:
 * - Сообщение кодируется в base32 и разбивается на части
 * - Каждая часть отправляется как DNS TXT запрос к нашему домену
 * - Формат: {chunk_id}.{msg_id}.{user_id}.msg.xamton.net
 * - Сервер декодирует запросы и собирает сообщение
 * - Ответы приходят как DNS TXT записи
 * 
 * Ограничения DNS:
 * - Метка (label) макс 63 символа
 * - Полный FQDN макс 253 символа
 * - Используем base32 (только a-z0-9) для безопасного кодирования
 */

import { useTransportStore } from '../../store/useTransportStore';

// DNS over HTTPS провайдеры (обходят системный DNS который тоже могут блокировать)
const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://doh.opendns.com/dns-query',
];

const DNS_DOMAIN = process.env.EXPO_PUBLIC_DNS_DOMAIN || 'msg.xamton.net';
const CHUNK_MAX_BYTES = 45; // безопасный размер для base32 в DNS метке
const POLL_INTERVAL = 5000; // опрос каждые 5 секунд

// Base32 алфавит (RFC 4648, только lowercase для DNS)
const BASE32_CHARS = 'abcdefghijklmnopqrstuvwxyz234567';

function toBase32(bytes: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return result;
}

function fromBase32(str: string): Uint8Array {
  const lookup: Record<string, number> = {};
  BASE32_CHARS.split('').forEach((c, i) => { lookup[c] = i; });

  let bits = 0;
  let value = 0;
  const result: number[] = [];

  for (const char of str.toLowerCase()) {
    if (!(char in lookup)) continue;
    value = (value << 5) | lookup[char];
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(result);
}

interface DNSMessage {
  id: string;
  senderId: string;
  recipientId: string;
  payload: string;
  timestamp: number;
  totalChunks: number;
  chunkIndex: number;
}

type MessageHandler = (senderId: string, payload: string) => void;

class DNSTunnelTransport {
  private isRunning = false;
  private pollTimer?: ReturnType<typeof setInterval>;
  private myUserId = '';
  private messageHandlers: Set<MessageHandler> = new Set();
  private currentDOH = 0;
  private pendingChunks: Map<string, Map<number, string>> = new Map();

  async initialize(userId: string): Promise<boolean> {
    this.myUserId = userId;

    console.log('[DNS] Checking DoH availability...');
    
    // Проверяем доступность DNS over HTTPS
    const available = await this.checkDOHAvailability();
    if (available) {
      console.log('[DNS] ✓ DoH available, starting tunnel');
      this.isRunning = true;
      useTransportStore.getState().setTransportConnected('dns', true);
      this.startPolling();
      return true;
    }

    console.warn('[DNS] ✗ DoH not available - all providers failed');
    console.warn('[DNS] This is normal if:');
    console.warn('[DNS]   - Network blocks DoH (corporate/school WiFi)');
    console.warn('[DNS]   - Firewall restricts HTTPS DNS');
    console.warn('[DNS]   - No internet connection');
    console.warn('[DNS] App will work with other transports (WebSocket, BLE, WiFi Mesh)');
    return false;
  }

  private async checkDOHAvailability(): Promise<boolean> {
    // Проверяем доступность DoH провайдеров с реальным DNS запросом
    const testDomains = ['google.com', 'cloudflare.com', 'example.com'];
    
    for (let i = 0; i < DOH_PROVIDERS.length; i++) {
      try {
        // Создаём AbortController для timeout (React Native совместимый)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        // Пробуем запросить A запись для проверки работоспособности
        const res = await fetch(
          `${DOH_PROVIDERS[i]}?name=${testDomains[i % testDomains.length]}&type=A`,
          {
            headers: { Accept: 'application/dns-json' },
            signal: controller.signal,
          }
        );
        
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const data = await res.json();
          // Проверяем что получили валидный DNS ответ
          if (data && (data.Answer || data.Status === 0)) {
            this.currentDOH = i;
            console.log(`[DNS] DoH provider available: ${DOH_PROVIDERS[i]}`);
            return true;
          }
        }
      } catch (err: any) {
        console.log(`[DNS] DoH provider ${DOH_PROVIDERS[i]} failed:`, err.message || err);
      }
    }
    return false;
  }

  private getDOHUrl(): string {
    return DOH_PROVIDERS[this.currentDOH];
  }

  /**
   * Отправка сообщения через DNS TXT запросы
   * Кодируем payload в base32, разбиваем на чанки, каждый чанк = DNS запрос
   */
  async sendMessage(recipientId: string, payload: string): Promise<boolean> {
    if (!this.isRunning && !this.myUserId) return false;

    try {
      const msgId = Math.random().toString(36).slice(2, 10);
      const encoder = new TextEncoder();
      const payloadBytes = encoder.encode(payload);
      const payloadB32 = toBase32(payloadBytes);

      // Разбиваем на чанки по CHUNK_MAX_BYTES символов base32
      const chunks: string[] = [];
      for (let i = 0; i < payloadB32.length; i += CHUNK_MAX_BYTES) {
        chunks.push(payloadB32.slice(i, i + CHUNK_MAX_BYTES));
      }

      const totalChunks = chunks.length;
      const senderB32 = toBase32(new TextEncoder().encode(this.myUserId)).slice(0, 16);
      const recipientB32 = toBase32(new TextEncoder().encode(recipientId)).slice(0, 16);

      console.log(`[DNS] Sending ${totalChunks} chunks via DNS tunnel`);

      // Отправляем каждый чанк как DNS запрос
      // Формат: {chunk}.{index}-{total}.{msgid}.{sender}.{recipient}.msg.xamton.net
      const results = await Promise.all(
        chunks.map(async (chunk, index) => {
          const label = `${chunk}.${index}of${totalChunks}.${msgId}.${senderB32}.${recipientB32}.${DNS_DOMAIN}`;

          try {
            const res = await fetch(
              `${this.getDOHUrl()}?name=${label}&type=TXT`,
              {
                headers: { Accept: 'application/dns-json' },
                signal: AbortSignal.timeout(5000),
              }
            );
            return res.ok;
          } catch {
            return false;
          }
        })
      );

      const success = results.every(r => r);
      console.log(`[DNS] Send ${success ? 'OK' : 'FAILED'}`);
      return success;

    } catch (err) {
      console.warn('[DNS] Send error:', err);
      return false;
    }
  }

  /**
   * Polling: запрашиваем входящие сообщения через DNS TXT
   * Формат: inbox.{userIdB32}.{DNS_DOMAIN}
   */
  private startPolling(): void {
    this.isRunning = true;

    this.pollTimer = setInterval(async () => {
      await this.pollInbox();
    }, POLL_INTERVAL);

    // Первый опрос сразу
    this.pollInbox();
  }

  private async pollInbox(): Promise<void> {
    if (!this.myUserId) return;

    try {
      const userB32 = toBase32(new TextEncoder().encode(this.myUserId)).slice(0, 16);
      const query = `inbox.${userB32}.${DNS_DOMAIN}`;

      const res = await fetch(
        `${this.getDOHUrl()}?name=${query}&type=TXT`,
        {
          headers: { Accept: 'application/dns-json' },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!res.ok) return;

      const data = await res.json();
      const answers = data.Answer || [];

      for (const answer of answers) {
        if (answer.type === 16) { // TXT record
          await this.processInboxRecord(answer.data);
        }
      }
    } catch (err) {
      // DNS polling может временно не работать — не логируем спам
    }
  }

  private async processInboxRecord(txtData: string): Promise<void> {
    try {
      // TXT запись формат: {msgId}:{chunkIndex}/{total}:{senderB32}:{payloadChunk}
      const parts = txtData.replace(/"/g, '').split(':');
      if (parts.length < 4) return;

      const [msgId, chunkInfo, senderB32, payloadChunk] = parts;
      const [chunkIndex, totalChunks] = chunkInfo.split('/').map(Number);

      // Собираем чанки
      if (!this.pendingChunks.has(msgId)) {
        this.pendingChunks.set(msgId, new Map());
      }
      const chunks = this.pendingChunks.get(msgId)!;
      chunks.set(chunkIndex, payloadChunk);

      // Если все чанки получены — собираем сообщение
      if (chunks.size === totalChunks) {
        const fullB32 = Array.from({ length: totalChunks }, (_, i) => chunks.get(i) || '').join('');
        const payloadBytes = fromBase32(fullB32);
        const payload = new TextDecoder().decode(payloadBytes);
        const senderId = new TextDecoder().decode(fromBase32(senderB32));

        this.pendingChunks.delete(msgId);
        console.log('[DNS] Message assembled from', senderId.slice(0, 8));
        this.messageHandlers.forEach(h => h(senderId, payload));
      }
    } catch (err) {
      console.warn('[DNS] Process record error:', err);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  isReady(): boolean {
    return this.isRunning;
  }

  destroy(): void {
    this.isRunning = false;
    clearInterval(this.pollTimer);
    useTransportStore.getState().setTransportConnected('dns', false);
  }
}

export const dnsTunnel = new DNSTunnelTransport();
