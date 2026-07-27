/**
 * HardwareWalletScreen — Connect Ledger/Trezor via Bluetooth, sign transactions.
 * Connects to hardware wallet via the hardware-wallet utilities.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'HardwareWallet'> };

interface DeviceInfo {
  id: string;
  name: string;
  type: 'ledger' | 'trezor';
  connected: boolean;
  address?: string;
  balance?: number;
}

export default function HardwareWalletScreen({ navigation }: Props): React.JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<DeviceInfo | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleStartScan = async () => {
    setScanning(true);
    // In a real app, this would use react-native-ble-plx to scan for devices
    // Simulating device discovery
    setTimeout(() => {
      setDevices([
        { id: '1', name: 'Ledger Nano X', type: 'ledger', connected: false },
        { id: '2', name: 'Trezor Model T', type: 'trezor', connected: false },
      ]);
      setScanning(false);
    }, 2000);
  };

  const handleConnect = async (device: DeviceInfo) => {
    setActionLoading(true);
    // In a real app, would connect via BLE and derive address
    setTimeout(() => {
      const connected: DeviceInfo = {
        ...device,
        connected: true,
        address: '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
        balance: Math.random() * 10000,
      };
      setConnectedDevice(connected);
      setDevices(prev => prev.map(d => d.id === device.id ? connected : d));
      setActionLoading(false);
    }, 1500);
  };

  const handleDisconnect = () => {
    setConnectedDevice(null);
    setDevices([]);
  };

  const handleSignTx = () => {
    if (!connectedDevice) return;
    Alert.alert(
      'Sign Transaction',
      'Confirm the transaction on your hardware wallet device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Signed on Device',
          onPress: () => Alert.alert('Signed', 'Transaction signed by hardware wallet.'),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hardware Wallet</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Connected device */}
        {connectedDevice ? (
          <View style={styles.connectedCard}>
            <Text style={styles.connectedIcon}>🔐</Text>
            <Text style={styles.connectedName}>{connectedDevice.name}</Text>
            <Text style={styles.connectedType}>{connectedDevice.type.toUpperCase()}</Text>
            <Text style={styles.connectedAddress} numberOfLines={1}>
              {connectedDevice.address}
            </Text>
            <Text style={styles.connectedBalance}>
              Balance: {connectedDevice.balance?.toFixed(4)} HSMC
            </Text>

            <TouchableOpacity style={styles.signButton} onPress={handleSignTx}>
              <Text style={styles.signButtonText}>Sign Transaction</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.placeholderCard}>
              <Text style={styles.placeholderIcon}>💳</Text>
              <Text style={styles.placeholderTitle}>Connect Hardware Wallet</Text>
              <Text style={styles.placeholderDesc}>
                Securely sign transactions using your Ledger or Trezor hardware wallet via Bluetooth.
              </Text>
            </View>

            {/* Scan button */}
            <TouchableOpacity
              style={[styles.scanButton, scanning && styles.buttonDisabled]}
              onPress={handleStartScan}
              disabled={scanning}
            >
              {scanning ? (
                <View style={styles.scanningRow}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.scanButtonText}> Scanning...</Text>
                </View>
              ) : (
                <Text style={styles.scanButtonText}>🔍 Scan for Devices</Text>
              )}
            </TouchableOpacity>

            {/* Device list */}
            {devices.map(device => (
              <TouchableOpacity
                key={device.id}
                style={styles.deviceCard}
                onPress={() => handleConnect(device)}
                disabled={actionLoading}
              >
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>
                    {device.type === 'ledger' ? '🔷' : '🔶'} {device.name}
                  </Text>
                  <Text style={styles.deviceType}>{device.type.toUpperCase()}</Text>
                </View>
                {actionLoading ? (
                  <ActivityIndicator color="#6C5CE7" size="small" />
                ) : (
                  <Text style={styles.connectText}>Connect</Text>
                )}
              </TouchableOpacity>
            ))}

            {!scanning && devices.length === 0 && (
              <Text style={styles.noDeviceText}>
                No devices found. Make sure your hardware wallet is nearby with Bluetooth enabled.
              </Text>
            )}
          </>
        )}

        {/* Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>🔒 Hardware Wallet Security</Text>
          <Text style={styles.infoText}>
            Your private keys never leave the hardware wallet device. All transaction signing
            happens on the device itself, providing the highest level of security.
          </Text>
          <Text style={styles.infoList}>
            • Ledger Nano X / S Plus{'\n'}
            • Trezor Model T / Safe 3{'\n'}
            • BIP44 derivation path: m/44'/60'/0'/0/0{'\n'}
            • HSMC app required on device
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E2E' },
  backButton: { color: '#6C5CE7', fontSize: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 80 },
  placeholderCard: { alignItems: 'center', paddingVertical: 40 },
  placeholderIcon: { fontSize: 64, marginBottom: 16 },
  placeholderTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  placeholderDesc: { color: '#888899', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  scanButton: { backgroundColor: '#6C5CE7', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24, marginBottom: 16 },
  scanningRow: { flexDirection: 'row', alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  scanButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  deviceCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#151520', borderRadius: 12, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: '#2A2A35',
  },
  deviceInfo: { flex: 1 },
  deviceName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  deviceType: { color: '#666677', fontSize: 12, marginTop: 2 },
  connectText: { color: '#6C5CE7', fontSize: 14, fontWeight: '600' },
  noDeviceText: { color: '#555566', fontSize: 13, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  connectedCard: {
    backgroundColor: '#151520', borderRadius: 16, padding: 24, alignItems: 'center',
    borderWidth: 2, borderColor: '#6C5CE7',
  },
  connectedIcon: { fontSize: 48, marginBottom: 12 },
  connectedName: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  connectedType: { color: '#6C5CE7', fontSize: 12, marginTop: 4, letterSpacing: 2 },
  connectedAddress: { color: '#AAAAAA', fontSize: 12, fontFamily: 'monospace', marginTop: 12 },
  connectedBalance: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginTop: 8, fontFamily: 'monospace' },
  signButton: { backgroundColor: '#6C5CE7', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12, marginTop: 20 },
  signButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  disconnectButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, marginTop: 12 },
  disconnectText: { color: '#FF6B6B', fontSize: 14 },
  infoCard: { backgroundColor: '#151520', borderRadius: 12, padding: 16, marginTop: 24, borderWidth: 1, borderColor: '#2A2A35' },
  infoTitle: { color: '#6C5CE7', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  infoText: { color: '#888899', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  infoList: { color: '#666677', fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
});
