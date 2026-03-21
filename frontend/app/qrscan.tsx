/**
 * XAMTON QR Scan Screen
 * Сканирование QR собеседника и показ своего QR-кода
 * 
 * Использует:
 * - expo-camera для сканирования (с запросом разрешений)
 * - react-native-qrcode-svg для генерации QR
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useIdentityStore } from '../src/store/useIdentityStore';
import { useContactStore } from '../src/store/useContactStore';
import { Avatar } from '../src/components/common/Avatar';
import { colors } from '../src/theme/colors';
import { typography } from '../src/theme/typography';
import { spacing } from '../src/theme/spacing';
import { encodeBase64 } from 'tweetnacl-util';

// Условный импорт QRCode (может не работать на web)
let QRCode: any = null;
try {
  QRCode = require('react-native-qrcode-svg').default;
} catch (e) {
  // Fallback если библиотека недоступна
}

export default function QRScanScreen() {
  const router = useRouter();
  const { identity, displayName } = useIdentityStore();
  const { addContact } = useContactStore();
  const [mode, setMode] = useState<'scan' | 'show'>('show');
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Данные для QR-кода
  const myQRData = identity ? JSON.stringify({
    t: 'xamt',  // type: xamton contact
    u: identity.userId,
    n: displayName || 'User',
    k: encodeBase64(identity.identityKeyPair.publicKey),
    s: identity.identityKeyPair.signingPublicKey 
      ? encodeBase64(identity.identityKeyPair.signingPublicKey)
      : undefined,
  }) : '';

  // Переключение на скан — запрашиваем разрешение камеры
  const handleSwitchToScan = useCallback(async () => {
    setMode('scan');
    setScanned(false);
    
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Нужен доступ к камере',
          'Для сканирования QR-кода необходимо разрешение на использование камеры.',
          [
            { text: 'Отмена', style: 'cancel', onPress: () => setMode('show') },
            { text: 'Настройки', onPress: () => Linking.openSettings() },
          ]
        );
      }
    }
  }, [permission, requestPermission]);

  // Обработка сканированного QR
  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      const parsed = JSON.parse(data);
      
      if (parsed.t !== 'xamt') {
        Alert.alert('Ошибка', 'Это не QR-код XAMTON', [
          { text: 'OK', onPress: () => setScanned(false) }
        ]);
        return;
      }

      if (parsed.u === identity?.userId) {
        Alert.alert('Ошибка', 'Это ваш собственный QR-код', [
          { text: 'OK', onPress: () => setScanned(false) }
        ]);
        return;
      }

      // Декодируем ключ
      const { decodeBase64 } = require('tweetnacl-util');
      const identityKey = decodeBase64(parsed.k);

      Alert.alert(
        'Добавить контакт?',
        `Имя: ${parsed.n}\nID: ${parsed.u.slice(0, 20)}...`,
        [
          { text: 'Отмена', style: 'cancel', onPress: () => setScanned(false) },
          {
            text: 'Добавить',
            onPress: async () => {
              try {
                await addContact(parsed.u, parsed.n, identityKey, false);
                Alert.alert('Готово', `${parsed.n} добавлен в контакты`);
                router.back();
              } catch (error) {
                Alert.alert('Ошибка', 'Не удалось добавить контакт');
                setScanned(false);
              }
            }
          }
        ]
      );
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось распознать QR-код', [
        { text: 'OK', onPress: () => setScanned(false) }
      ]);
    }
  }, [scanned, identity, addContact, router]);

  return (
    <View style={styles.container}>
      {/* Mode Switcher */}
      <View style={styles.modeSwitcher}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'scan' && styles.modeButtonActive]}
          onPress={handleSwitchToScan}
        >
          <Ionicons
            name="scan"
            size={20}
            color={mode === 'scan' ? '#FFFFFF' : colors.light.textSecondary}
          />
          <Text style={[styles.modeText, mode === 'scan' && styles.modeTextActive]}>
            Сканировать
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'show' && styles.modeButtonActive]}
          onPress={() => setMode('show')}
        >
          <Ionicons
            name="qr-code"
            size={20}
            color={mode === 'show' ? '#FFFFFF' : colors.light.textSecondary}
          />
          <Text style={[styles.modeText, mode === 'show' && styles.modeTextActive]}>
            Мой QR
          </Text>
        </TouchableOpacity>
      </View>

      {mode === 'show' ? (
        /* ===== ПОКАЗ СВОЕГО QR-КОДА ===== */
        <View style={styles.qrContainer}>
          <Avatar name={displayName || 'User'} size="large" />
          <Text style={styles.userName}>{displayName || 'User'}</Text>
          <Text style={styles.userId}>{identity?.userId || ''}</Text>
          
          <View style={styles.qrBox}>
            {QRCode && myQRData ? (
              <QRCode
                value={myQRData}
                size={200}
                backgroundColor="white"
                color="black"
              />
            ) : (
              <View style={styles.qrFallback}>
                <Ionicons name="qr-code" size={120} color={colors.light.textPrimary} />
                <Text style={styles.qrFallbackText}>
                  QR-библиотека недоступна
                </Text>
              </View>
            )}
          </View>
          
          <Text style={styles.hint}>
            Покажите этот QR-код собеседнику,{"\n"}
            чтобы он мог добавить вас в контакты
          </Text>

          <TouchableOpacity
            style={styles.shareButton}
            onPress={async () => {
              if (!identity) return;
              const name = encodeURIComponent(displayName || 'User');
              const key = encodeBase64(identity.identityKeyPair.publicKey);
              const link = `xamton://invite?u=${identity.userId}&k=${encodeURIComponent(key)}&n=${name}`;
              try {
                await Share.share({
                  message: `Добавь меня в XAMTON: ${link}`,
                  title: 'XAMTON — приглашение',
                });
              } catch {}
            }}
          >
            <Ionicons name="share-outline" size={20} color="#FFFFFF" />
            <Text style={styles.shareButtonText}>Поделиться ссылкой</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* ===== СКАНИРОВАНИЕ QR-КОДА ===== */
        <View style={styles.scanContainer}>
          {permission?.granted ? (
            <View style={styles.cameraWrapper}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
              />
              
              {/* Рамка прицела */}
              <View style={styles.overlay}>
                <View style={styles.scanFrame}>
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
              </View>
              
              <Text style={styles.scanHint}>
                Наведите камеру на QR-код собеседника
              </Text>
              
              {scanned && (
                <TouchableOpacity
                  style={styles.rescanButton}
                  onPress={() => setScanned(false)}
                >
                  <Text style={styles.rescanText}>Сканировать снова</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : permission === null ? (
            <ActivityIndicator size="large" color={colors.light.primary} />
          ) : (
            <View style={styles.noPermission}>
              <Ionicons name="camera-outline" size={64} color={colors.light.textTertiary} />
              <Text style={styles.noPermissionTitle}>Нет доступа к камере</Text>
              <Text style={styles.noPermissionText}>
                Разрешите доступ к камере{"\n"}в настройках устройства
              </Text>
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => Linking.openSettings()}
              >
                <Text style={styles.settingsButtonText}>Открыть настройки</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.settingsButton, { backgroundColor: colors.light.textTertiary, marginTop: 12 }]}
                onPress={() => requestPermission()}
              >
                <Text style={styles.settingsButtonText}>Запросить снова</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  modeSwitcher: {
    flexDirection: 'row',
    margin: spacing.md,
    backgroundColor: colors.light.inputBackground,
    borderRadius: spacing.borderRadiusMd,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: spacing.borderRadiusSm,
    gap: spacing.xs,
  },
  modeButtonActive: {
    backgroundColor: colors.light.primary,
  },
  modeText: {
    ...typography.buttonSmall,
    color: colors.light.textSecondary,
  },
  modeTextActive: {
    color: '#FFFFFF',
  },
  // === Show QR ===
  qrContainer: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.xl,
  },
  userName: {
    ...typography.h3,
    color: colors.light.textPrimary,
    marginTop: spacing.md,
  },
  userId: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginTop: 4,
    maxWidth: 250,
    textAlign: 'center',
  },
  qrBox: {
    width: 230,
    height: 230,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    marginTop: spacing.xl,
    padding: 15,
    // Тень
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  qrFallback: {
    alignItems: 'center',
  },
  qrFallbackText: {
    ...typography.caption,
    color: colors.light.textTertiary,
    marginTop: 8,
  },
  hint: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.light.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: spacing.lg,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // === Scan QR ===
  scanContainer: {
    flex: 1,
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#FFFFFF',
  },
  cornerTL: {
    top: 0, left: 0,
    borderTopWidth: 3, borderLeftWidth: 3,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: 0, right: 0,
    borderTopWidth: 3, borderRightWidth: 3,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    bottom: 0, left: 0,
    borderBottomWidth: 3, borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0, right: 0,
    borderBottomWidth: 3, borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  scanHint: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  rescanButton: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    backgroundColor: colors.light.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  rescanText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // === No Permission ===
  noPermission: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  noPermissionTitle: {
    ...typography.h3,
    color: colors.light.textPrimary,
    marginTop: spacing.md,
  },
  noPermissionText: {
    ...typography.body,
    color: colors.light.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  settingsButton: {
    backgroundColor: colors.light.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: spacing.xl,
  },
  settingsButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
