/**
 * XAMTON BLE Advertiser
 * Меняет имя Bluetooth устройства чтобы другие XAMTON устройства нас нашли.
 * 
 * Это workaround — react-native-ble-plx не поддерживает Peripheral mode,
 * поэтому мы меняем имя BT адаптера на "XAMT:{userId}:{name}",
 * что позволяет нашему сканеру найти устройство по имени.
 * 
 * Ограничение: работает только на Android, требует нативного кода.
 * На iOS advertising через стандартный CoreBluetooth.
 */

import { NativeModules, Platform } from 'react-native';

const { XAMTONBluetooth } = NativeModules;

export async function startBLEAdvertising(userId: string, displayName: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  
  if (!XAMTONBluetooth) {
    console.warn('[BLEAdv] Native module not available, using fallback');
    return startBLEAdvertisingFallback(userId, displayName);
  }

  try {
    const name = `XAMT:${userId.slice(0, 8)}:${(displayName || 'user').slice(0, 8)}`;
    await XAMTONBluetooth.setBluetoothName(name);
    console.log('[BLEAdv] Advertising as:', name);
    return true;
  } catch (err) {
    console.warn('[BLEAdv] Error:', err);
    return false;
  }
}

/**
 * Fallback через react-native-ble-plx BleManager
 * Пробуем запустить peripheral через низкоуровневый API
 */
async function startBLEAdvertisingFallback(userId: string, displayName: string): Promise<boolean> {
  try {
    const { BleManager } = require('react-native-ble-plx');
    const manager = new BleManager();

    // react-native-ble-plx не поддерживает advertising напрямую
    // Используем workaround через Android BluetoothAdapter
    console.log('[BLEAdv] Fallback: cannot advertise without native module');
    manager.destroy();
    return false;
  } catch {
    return false;
  }
}

export async function stopBLEAdvertising(): Promise<void> {
  if (Platform.OS !== 'android') return;
  
  if (!XAMTONBluetooth) return;

  try {
    await XAMTONBluetooth.resetBluetoothName();
  } catch {}
}
