/**
 * XAMTON Transport Indicator
 * Иконка текущего транспорта
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TransportType } from '../../core/crypto/types';
import { colors } from '../../theme/colors';

interface TransportIndicatorProps {
  type: TransportType;
  size?: 'small' | 'medium';
  showLabel?: boolean;
}

const transportConfig: Record<TransportType, { icon: string; color: string; label: string }> = {
  internet: {
    icon: 'globe-outline',
    color: colors.light.transportInternet,
    label: 'Internet',
  },
  dns: {
    icon: 'server-outline',
    color: colors.light.transportDNS,
    label: 'DNS',
  },
  mesh_ble: {
    icon: 'bluetooth-outline',
    color: colors.light.transportMesh,
    label: 'BLE',
  },
  mesh_wifi: {
    icon: 'wifi-outline',
    color: colors.light.transportMesh,
    label: 'WiFi',
  },
  offline: {
    icon: 'cloud-offline-outline',
    color: colors.light.transportOffline,
    label: 'Оффлайн',
  },
};

export function TransportIndicator({ type, size = 'small', showLabel = false }: TransportIndicatorProps) {
  const config = transportConfig[type];
  const iconSize = size === 'small' ? 12 : 16;

  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: config.color }]}>
        <Ionicons name={config.icon as any} size={iconSize} color="#FFFFFF" />
      </View>
      {showLabel && <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconContainer: {
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
});
