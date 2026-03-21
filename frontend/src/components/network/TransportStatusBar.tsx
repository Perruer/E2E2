/**
 * XAMTON TransportStatusBar
 * Полоска статуса транспорта вверху списка чатов
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTransportStore } from '../../store/useTransportStore';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';

interface TransportStatusBarProps {
  onPress?: () => void;
}

export function TransportStatusBar({ onPress }: TransportStatusBarProps) {
  const { transports, totalPeers } = useTransportStore();

  const internetConnected = transports.internet.connected;
  const meshConnected = transports.mesh_ble.connected || transports.mesh_wifi.connected;
  const dnsActive = transports.dns.enabled && transports.dns.connected;

  // Определяем текущий статус
  let statusColor = colors.light.danger;
  let statusText = 'Нет подключения';
  let iconName: keyof typeof Ionicons.glyphMap = 'cloud-offline-outline';

  if (internetConnected) {
    statusColor = colors.light.transportInternet;
    statusText = `Интернет${totalPeers > 0 ? ` • ${totalPeers} онлайн` : ''}`;
    iconName = 'cloud-done-outline';
  } else if (dnsActive) {
    statusColor = colors.light.transportDNS;
    statusText = 'DNS-туннель';
    iconName = 'server-outline';
  } else if (meshConnected) {
    statusColor = colors.light.transportMesh;
    statusText = 'Mesh-сеть';
    iconName = 'git-network-outline';
  }

  return (
    <TouchableOpacity style={[styles.bar, { backgroundColor: statusColor }]} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={iconName} size={14} color="#FFFFFF" />
      <Text style={styles.text}>{statusText}</Text>
      <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.7)" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    gap: spacing.xs,
  },
  text: {
    ...typography.caption,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
