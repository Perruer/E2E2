/**
 * XAMTON Network Settings Screen
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTransportStore } from '../src/store/useTransportStore';
import { colors } from '../src/theme/colors';
import { typography } from '../src/theme/typography';
import { spacing } from '../src/theme/spacing';
import { TransportType } from '../src/core/crypto/types';

const transportLabels: Record<TransportType, { label: string; description: string; icon: string }> = {
  internet: {
    label: 'Интернет (TCP/TLS)',
    description: 'Прямое подключение через интернет',
    icon: 'globe-outline',
  },
  dns: {
    label: 'DNS-туннель',
    description: 'Работает даже при блокировке интернета',
    icon: 'server-outline',
  },
  mesh_ble: {
    label: 'Bluetooth Mesh',
    description: 'Связь с ближайшими устройствами',
    icon: 'bluetooth-outline',
  },
  mesh_wifi: {
    label: 'WiFi Direct',
    description: 'Прямое WiFi соединение',
    icon: 'wifi-outline',
  },
  offline: {
    label: 'Оффлайн',
    description: 'Сообщения в очереди',
    icon: 'cloud-offline-outline',
  },
};

export default function NetworkScreen() {
  const { transports, isRelayEnabled, toggleTransport, toggleRelay, totalPeers } = useTransportStore();

  const getStatusColor = (type: TransportType) => {
    const transport = transports[type];
    if (!transport.enabled) return colors.light.textTertiary;
    if (transport.connected) {
      switch (type) {
        case 'internet': return colors.light.transportInternet;
        case 'dns': return colors.light.transportDNS;
        case 'mesh_ble':
        case 'mesh_wifi': return colors.light.transportMesh;
        default: return colors.light.textTertiary;
      }
    }
    return colors.light.warning;
  };

  const getStatusText = (type: TransportType) => {
    const transport = transports[type];
    if (!transport.enabled) return 'Выключен';
    if (transport.connected) return 'Активен';
    return 'Готов';
  };

  const transportOrder: TransportType[] = ['internet', 'dns', 'mesh_ble', 'mesh_wifi'];

  return (
    <ScrollView style={styles.container}>
      {/* Status Overview */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: colors.light.transportInternet }]} />
          <Text style={styles.statusLabel}>Всего peers:</Text>
          <Text style={styles.statusValue}>{totalPeers}</Text>
        </View>
      </View>

      {/* Active Transports */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Активные транспорты</Text>
        
        {transportOrder.map(type => {
          const transport = transports[type];
          const config = transportLabels[type];
          const statusColor = getStatusColor(type);
          
          return (
            <View key={type} style={styles.transportItem}>
              <View style={[styles.transportStatus, { backgroundColor: statusColor }]} />
              <View style={[styles.transportIcon, { backgroundColor: statusColor }]}>
                <Ionicons name={config.icon as any} size={20} color="#FFFFFF" />
              </View>
              <View style={styles.transportInfo}>
                <Text style={styles.transportLabel}>{config.label}</Text>
                <Text style={styles.transportDescription}>
                  {getStatusText(type)}
                  {transport.peerCount > 0 && ` • ${transport.peerCount} peers`}
                  {transport.latency && ` • ${transport.latency}ms`}
                </Text>
              </View>
              <Switch
                value={transport.enabled}
                onValueChange={() => toggleTransport(type)}
                trackColor={{ false: colors.light.border, true: colors.light.primary }}
              />
            </View>
          );
        })}
      </View>

      {/* Mesh Visualization */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mesh-визуализация</Text>
        <View style={styles.meshContainer}>
          <View style={styles.meshGraph}>
            {/* Простая визуализация */}
            <View style={styles.meshCenter}>
              <View style={styles.meshNodeSelf}>
                <Text style={styles.meshNodeText}>Я</Text>
              </View>
            </View>
            
            <View style={styles.meshPeers}>
              {[1, 2, 3].map(i => (
                <View key={i} style={styles.meshNode}>
                  <Text style={styles.meshNodeText}>P{i}</Text>
                </View>
              ))}
            </View>
            
            {/* Линии связи */}
            <View style={styles.meshLines}>
              {[1, 2, 3].map(i => (
                <View
                  key={i}
                  style={[
                    styles.meshLine,
                    {
                      transform: [{ rotate: `${(i - 1) * 120}deg` }],
                    },
                  ]}
                />
              ))}
            </View>
          </View>
          
          <Text style={styles.meshHint}>
            Визуализация mesh-сети в реальном времени
          </Text>
        </View>
      </View>

      {/* Relay Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Настройки ретрансляции</Text>
        <View style={styles.relayItem}>
          <View style={styles.relayInfo}>
            <Text style={styles.relayLabel}>Ретрансляция чужих сообщений</Text>
            <Text style={styles.relayDescription}>
              Помогать другим участникам сети{"\n"}
              доставлять сообщения (анонимно)
            </Text>
          </View>
          <Switch
            value={isRelayEnabled}
            onValueChange={toggleRelay}
            trackColor={{ false: colors.light.border, true: colors.light.primary }}
          />
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={20} color={colors.light.primary} />
        <Text style={styles.infoText}>
          XAMTON автоматически выбирает оптимальный транспорт для доставки сообщений.
          При блокировке интернета сообщения будут доставлены через mesh-сеть.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.light.inputBackground,
  },
  statusCard: {
    backgroundColor: colors.light.background,
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: spacing.borderRadiusMd,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacing.sm,
  },
  statusLabel: {
    ...typography.body,
    color: colors.light.textSecondary,
  },
  statusValue: {
    ...typography.h3,
    color: colors.light.textPrimary,
    marginLeft: spacing.sm,
  },
  section: {
    backgroundColor: colors.light.background,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.light.textSecondary,
    textTransform: 'uppercase',
    marginLeft: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  transportItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.separator,
  },
  transportStatus: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: spacing.md,
  },
  transportIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transportInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  transportLabel: {
    ...typography.body,
    color: colors.light.textPrimary,
  },
  transportDescription: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginTop: 2,
  },
  meshContainer: {
    padding: spacing.md,
    alignItems: 'center',
  },
  meshGraph: {
    width: 200,
    height: 200,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  meshCenter: {
    position: 'absolute',
    zIndex: 2,
  },
  meshNodeSelf: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  meshPeers: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  meshNode: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.light.transportMesh,
    justifyContent: 'center',
    alignItems: 'center',
  },
  meshNodeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  meshLines: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  meshLine: {
    position: 'absolute',
    width: 2,
    height: 60,
    backgroundColor: colors.light.border,
    left: '50%',
    top: '50%',
    marginLeft: -1,
    transformOrigin: 'top',
  },
  meshHint: {
    ...typography.caption,
    color: colors.light.textTertiary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  relayItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  relayInfo: {
    flex: 1,
  },
  relayLabel: {
    ...typography.body,
    color: colors.light.textPrimary,
  },
  relayDescription: {
    ...typography.caption,
    color: colors.light.textSecondary,
    marginTop: 2,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(91, 155, 213, 0.1)',
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: spacing.borderRadiusMd,
    gap: spacing.sm,
  },
  infoText: {
    ...typography.bodySmall,
    color: colors.light.textPrimary,
    flex: 1,
  },
});
