/**
 * XAMTON Transport Store
 */
import { create } from 'zustand';
import { TransportState, TransportType } from '../core/crypto/types';

type TransportMap = Record<TransportType, TransportState>;

interface TransportStore {
  transports: TransportMap;
  isRelayEnabled: boolean;
  totalPeers: number;

  toggleTransport: (type: TransportType) => void;
  toggleRelay: () => void;
  setTransportConnected: (type: TransportType, connected: boolean, peerCount?: number, latency?: number) => void;
  setTotalPeers: (count: number) => void;
}

const defaultTransports: TransportMap = {
  internet: { enabled: true, connected: false, peerCount: 0 },
  dns: { enabled: false, connected: false, peerCount: 0 },
  mesh_ble: { enabled: false, connected: false, peerCount: 0 },
  mesh_wifi: { enabled: false, connected: false, peerCount: 0 },
  offline: { enabled: true, connected: true, peerCount: 0 },
};

export const useTransportStore = create<TransportStore>((set, get) => ({
  transports: defaultTransports,
  isRelayEnabled: false,
  totalPeers: 0,

  toggleTransport: (type) => {
    const transports = { ...get().transports };
    transports[type] = { ...transports[type], enabled: !transports[type].enabled };
    set({ transports });
  },

  toggleRelay: () => {
    set(state => ({ isRelayEnabled: !state.isRelayEnabled }));
  },

  setTransportConnected: (type, connected, peerCount = 0, latency) => {
    const transports = { ...get().transports };
    transports[type] = { ...transports[type], connected, peerCount, latency };
    set({ transports });
  },

  setTotalPeers: (count) => set({ totalPeers: count }),
}));
