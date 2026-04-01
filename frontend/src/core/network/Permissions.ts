/**
 * XAMTON Permissions Manager
 * Запрашивает все нужные разрешения для BLE и WiFi (включая WiFi Aware для Meshrabiya)
 */
import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';

export interface PermissionResult {
  bluetooth: boolean;
  location: boolean;
  wifi: boolean;
  wifiAware: boolean;
}

export async function requestAllPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    // iOS — разрешения через Info.plist, спрашиваются автоматически
    return { bluetooth: true, location: true, wifi: true, wifiAware: false };
  }

  const result: PermissionResult = {
    bluetooth: false,
    location: false,
    wifi: true, // WiFi не требует явного разрешения
    wifiAware: false,
  };

  try {
    const androidVersion = parseInt(Platform.Version as string, 10);

    if (androidVersion >= 31) {
      // Android 12+ — новые BLE разрешения
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

      // Android 13+ — WiFi Aware разрешение
      if (androidVersion >= 33) {
        permissions.push(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
      }

      const blePermissions = await PermissionsAndroid.requestMultiple(permissions);

      result.bluetooth =
        blePermissions[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === 'granted' &&
        blePermissions[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === 'granted' &&
        blePermissions[PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE] === 'granted';

      result.location =
        blePermissions[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === 'granted';

      // WiFi Aware permission (Android 13+)
      if (androidVersion >= 33 && PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES) {
        result.wifiAware =
          blePermissions[PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES] === 'granted';
      }

    } else {
      // Android < 12 — старые разрешения
      const locationPerm = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'XAMTON — Разрешение на геолокацию',
          message: 'Для поиска устройств через Bluetooth необходим доступ к геолокации.',
          buttonPositive: 'Разрешить',
          buttonNegative: 'Отмена',
        }
      );

      result.bluetooth = locationPerm === 'granted';
      result.location = locationPerm === 'granted';
    }

    console.log('[Permissions] BLE:', result.bluetooth, 'Location:', result.location, 'WiFi Aware:', result.wifiAware);
    return result;

  } catch (err) {
    console.warn('[Permissions] Request error:', err);
    return result;
  }
}

export async function checkBluetoothEnabled(): Promise<boolean> {
  // Проверяем через react-native-ble-plx
  try {
    const { BleManager } = require('react-native-ble-plx');
    const manager = new BleManager();

    return new Promise((resolve) => {
      const sub = manager.onStateChange((state: string) => {
        sub.remove();
        manager.destroy();
        resolve(state === 'PoweredOn');
      }, true);

      setTimeout(() => {
        sub.remove();
        manager.destroy();
        resolve(false);
      }, 3000);
    });
  } catch {
    return false;
  }
}

export function showBluetoothDisabledAlert(): void {
  Alert.alert(
    'Bluetooth выключен',
    'Включите Bluetooth для работы mesh-сети без интернета.',
    [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Настройки', onPress: () => Linking.openSettings() },
    ]
  );
}

export function showPermissionDeniedAlert(): void {
  Alert.alert(
    'Нет разрешений',
    'Для работы Bluetooth Mesh необходимы разрешения на Bluetooth и геолокацию.',
    [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Настройки', onPress: () => Linking.openSettings() },
    ]
  );
}
