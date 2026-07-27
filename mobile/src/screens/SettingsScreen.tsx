/**
 * SettingsScreen — Network, security, notifications, currency, export seed, about.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, Switch, Alert, TextInput,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import { clearAllData } from '../services/wallet';
import { getTreasuryBalance } from '../services/api';
import { getNotifications, clearNotifications } from '../services/notifications';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Settings'> };

export default function SettingsScreen({ navigation }: Props): React.JSX.Element {
  const { logout, wallet } = useAppStore();
  const [networkMode, setNetworkMode] = useState('mainnet');
  const [nodeUrl, setNodeUrl] = useState('http://localhost:3001');
  const [currency, setCurrency] = useState('USD');
  const [autoLockTimeout, setAutoLockTimeout] = useState('5min');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showNodeUrl, setShowNodeUrl] = useState(false);

  const handleExportSeed = () => {
    Alert.alert(
      'Export Seed Phrase',
      '⚠️ Never share your seed phrase. Anyone with these words can access your funds.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reveal',
          style: 'destructive',
          onPress: () => {
            // Would decrypt and show seed
            Alert.alert('Seed Phrase', 'Enter your password to reveal your seed phrase.');
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Lock Wallet', 'Your wallet will be locked.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock', onPress: () => { logout(); navigation.navigate('Welcome'); } },
    ]);
  };

  const handleReset = () => {
    Alert.alert(
      '⚠️ Reset Wallet',
      'This will remove ALL wallet data from this device. You MUST have your seed phrase to recover.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive',
          onPress: async () => {
            await clearAllData();
            logout();
            navigation.navigate('Welcome');
          },
        },
      ]
    );
  };

  const autoLockOptions = ['1min', '5min', '15min', '1hour', 'Never'];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Network */}
        <Text style={styles.sectionTitle}>Network</Text>
        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Network Mode</Text>
            <View style={styles.networkToggle}>
              {['mainnet', 'testnet'].map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.networkOption, networkMode === mode && styles.networkOptionActive]}
                  onPress={() => setNetworkMode(mode)}
                >
                  <Text style={[styles.networkOptionText, networkMode === mode && styles.networkOptionTextActive]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity onPress={() => setShowNodeUrl(!showNodeUrl)}>
            <Text style={styles.settingLabel}>Node URL</Text>
          </TouchableOpacity>
          {showNodeUrl && (
            <TextInput
              style={styles.input}
              value={nodeUrl}
              onChangeText={setNodeUrl}
              placeholder="http://localhost:3001"
              placeholderTextColor="#555566"
              autoCapitalize="none"
            />
          )}
        </View>

        {/* Display */}
        <Text style={styles.sectionTitle}>Display</Text>
        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Currency</Text>
            <View style={styles.currencyToggle}>
              {['USD', 'EUR', 'RON'].map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.currencyOption, currency === c && styles.currencyOptionActive]}
                  onPress={() => setCurrency(c)}
                >
                  <Text style={[styles.currencyText, currency === c && styles.currencyTextActive]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Security */}
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Auto-Lock</Text>
          </View>
          <View style={styles.autoLockOptions}>
            {autoLockOptions.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.autoLockOption, autoLockTimeout === opt && styles.autoLockOptionActive]}
                onPress={() => setAutoLockTimeout(opt)}
              >
                <Text style={[styles.autoLockText, autoLockTimeout === opt && styles.autoLockTextActive]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.divider} />
          <TouchableOpacity
                style={styles.settingRow}
                onPress={() => navigation.navigate('BiometricSetup')}
              >
                <Text style={styles.settingLabel}>Biometric Unlock</Text>
                <Text style={styles.settingValue}>Setup →</Text>
              </TouchableOpacity>
        </View>

        {/* Notifications */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Push Notifications</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: '#2A2A35', true: '#6C5CE7' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.divider} />
          <TouchableOpacity onPress={() => {
            clearNotifications();
            Alert.alert('Cleared', 'All notifications cleared.');
          }}>
            <Text style={styles.settingLabel}>Clear Notifications</Text>
          </TouchableOpacity>
        </View>

        {/* Wallet Management */}
        <Text style={styles.sectionTitle}>Wallet</Text>
        <View style={styles.settingCard}>
          <TouchableOpacity style={styles.settingRow} onPress={handleExportSeed}>
            <Text style={[styles.settingLabel, { color: '#FFB74D' }]}>⚠ Export Seed Phrase</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingRow} onPress={handleLogout}>
            <Text style={styles.settingLabel}>🔒 Lock Wallet</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingRow} onPress={handleReset}>
            <Text style={[styles.settingLabel, { color: '#FF5252' }]}>🗑 Reset Wallet</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Version</Text>
            <Text style={styles.settingValue}>1.0.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Build</Text>
            <Text style={styles.settingValue}>2026.07.26</Text>
          </View>
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
  sectionTitle: { color: '#888899', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 24, marginBottom: 8, paddingLeft: 4 },
  settingCard: { backgroundColor: '#151520', borderRadius: 12, padding: 4, borderWidth: 1, borderColor: '#2A2A35' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  settingLabel: { color: '#FFFFFF', fontSize: 15 },
  settingValue: { color: '#666677', fontSize: 14 },
  divider: { height: 1, backgroundColor: '#2A2A35', marginHorizontal: 16 },
  networkToggle: { flexDirection: 'row', gap: 4 },
  networkOption: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#0A0A0F' },
  networkOptionActive: { backgroundColor: '#6C5CE7' },
  networkOptionText: { color: '#888899', fontSize: 12, fontWeight: '600' },
  networkOptionTextActive: { color: '#FFFFFF' },
  input: { backgroundColor: '#0A0A0F', borderRadius: 8, padding: 12, color: '#FFFFFF', fontSize: 14, marginHorizontal: 16, marginBottom: 8, fontFamily: 'monospace' },
  currencyToggle: { flexDirection: 'row', gap: 4 },
  currencyOption: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#0A0A0F' },
  currencyOptionActive: { backgroundColor: '#6C5CE7' },
  currencyText: { color: '#888899', fontSize: 12, fontWeight: '600' },
  currencyTextActive: { color: '#FFFFFF' },
  autoLockOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  autoLockOption: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#0A0A0F' },
  autoLockOptionActive: { backgroundColor: '#6C5CE7' },
  autoLockText: { color: '#888899', fontSize: 12, fontWeight: '600' },
  autoLockTextActive: { color: '#FFFFFF' },
});
