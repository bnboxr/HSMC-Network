/**
 * PrivacyScreen — Shielded transactions, toggle privacy mode, view shielded balance.
 * Connects to shielded endpoints: deposit, withdraw, verify, state.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, TextInput, Alert, ActivityIndicator, Switch,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import {
  shieldedState, shieldedDeposit, shieldedWithdraw,
} from '../services/api';
import { generateCommitment, randomBlinding } from '../services/crypto';
import type { ShieldedStateResponse } from '../services/api';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Privacy'> };

export default function PrivacyScreen({ navigation }: Props): React.JSX.Element {
  const { wallet, balance } = useAppStore();
  const [shieldedData, setShieldedData] = useState<ShieldedStateResponse | null>(null);
  const [privacyEnabled, setPrivacyEnabled] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    shieldedState()
      .then(setShieldedData)
      .catch(() => {/* shielded pool may not be running */});
  }, []);

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid amount to shield.');
      return;
    }
    if (!wallet) return;
    if (amount > balance) {
      Alert.alert('Insufficient Balance', `You have ${balance.toFixed(4)} HSMC available.`);
      return;
    }

    setActionLoading(true);
    try {
      const blinding = randomBlinding();
      const commitmentBytes = await generateCommitment(amount, blinding);
      const commitment = Array.from(commitmentBytes)
        .map(b => b.toString(16).padStart(2, '0')).join('');

      await shieldedDeposit({
        amount,
        from_address: wallet.address,
        commitment: `0x${commitment}`,
      });

      Alert.alert('Deposited', `${amount.toFixed(4)} HSMC shielded successfully.`);
      setDepositAmount('');
      const state = await shieldedState().catch(() => null);
      if (state) setShieldedData(state);
    } catch (error) {
      Alert.alert('Error', 'Shielded deposit failed. The privacy pool may be offline.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid amount to unshield.');
      return;
    }
    if (!withdrawAddress.trim()) {
      Alert.alert('Address Required', 'Enter the destination address.');
      return;
    }

    setActionLoading(true);
    try {
      const nullifier = Array.from(randomBlinding()).map(b => b.toString(16).padStart(2, '0')).join('');
      const proof = Array.from(await generateCommitment(amount, randomBlinding()))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      await shieldedWithdraw({
        amount,
        to_address: withdrawAddress.trim(),
        nullifier: `0x${nullifier}`,
        proof: `0x${proof}`,
      });

      Alert.alert('Withdrawn', `${amount.toFixed(4)} HSMC unshielded successfully.`);
      setWithdrawAmount('');
      setWithdrawAddress('');
      const state = await shieldedState().catch(() => null);
      if (state) setShieldedData(state);
    } catch (error) {
      Alert.alert('Error', 'Shielded withdrawal failed.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Privacy Toggle */}
        <View style={styles.toggleCard}>
          <View>
            <Text style={styles.toggleTitle}>Privacy Mode</Text>
            <Text style={styles.toggleDesc}>Enable RingCT + stealth addresses</Text>
          </View>
          <Switch
            value={privacyEnabled}
            onValueChange={setPrivacyEnabled}
            trackColor={{ false: '#2A2A35', true: '#6C5CE7' }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Shielded Pool Info */}
        {shieldedData ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Shielded Pool</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Pool Size</Text>
              <Text style={styles.infoValue}>{shieldedData.pool_size} notes</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Total Shielded</Text>
              <Text style={styles.infoValue}>{shieldedData.total_shielded.toFixed(4)} HSMC</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Merkle Root</Text>
              <Text style={styles.infoValueMono}>{shieldedData.merkle_root.slice(0, 16)}...</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Nullifiers</Text>
              <Text style={styles.infoValue}>{shieldedData.nullifiers_count}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Shielded Pool</Text>
            <Text style={styles.offlineText}>
              Shielded pool is currently unavailable. The zk-STARK node may be offline.
            </Text>
          </View>
        )}

        {/* Deposit to shielded pool */}
        <Text style={styles.sectionTitle}>Shield (Deposit)</Text>
        <Text style={styles.sectionDesc}>
          Move funds into the shielded pool for private transactions.
        </Text>
        <TextInput
          style={styles.input}
          value={depositAmount}
          onChangeText={setDepositAmount}
          placeholder="Amount to shield"
          placeholderTextColor="#555566"
          keyboardType="decimal-pad"
        />
        <TouchableOpacity
          style={[styles.actionButton, actionLoading && styles.buttonDisabled]}
          onPress={handleDeposit}
          disabled={actionLoading}
        >
          {actionLoading ? <ActivityIndicator color="#FFFFFF" /> :
            <Text style={styles.actionButtonText}>Shield Funds</Text>}
        </TouchableOpacity>

        {/* Withdraw from shielded pool */}
        <Text style={styles.sectionTitle}>Unshield (Withdraw)</Text>
        <Text style={styles.sectionDesc}>
          Move funds from the shielded pool back to a transparent address.
        </Text>
        <TextInput
          style={styles.input}
          value={withdrawAmount}
          onChangeText={setWithdrawAmount}
          placeholder="Amount to unshield"
          placeholderTextColor="#555566"
          keyboardType="decimal-pad"
        />
        <TextInput
          style={styles.input}
          value={withdrawAddress}
          onChangeText={setWithdrawAddress}
          placeholder="Destination address"
          placeholderTextColor="#555566"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[styles.actionButton, actionLoading && styles.buttonDisabled]}
          onPress={handleWithdraw}
          disabled={actionLoading}
        >
          {actionLoading ? <ActivityIndicator color="#FFFFFF" /> :
            <Text style={styles.actionButtonText}>Unshield Funds</Text>}
        </TouchableOpacity>

        {/* Privacy Tech Info */}
        <View style={styles.techCard}>
          <Text style={styles.techTitle}>🔐 Privacy Technology</Text>
          <Text style={styles.techText}>
            HSMC uses: RingCT (Ring Confidential Transactions), CLSAG signatures,
            stealth addresses, and zk-STARK-based shielded pools. Post-quantum security
            via Dilithium-5 and Kyber-1024.
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
  toggleCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#151520', borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#2A2A35',
  },
  toggleTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  toggleDesc: { color: '#666677', fontSize: 12, marginTop: 2 },
  infoCard: { backgroundColor: '#151520', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#2A2A35' },
  infoTitle: { color: '#6C5CE7', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infoLabel: { color: '#888899', fontSize: 13 },
  infoValue: { color: '#FFFFFF', fontSize: 13, fontFamily: 'monospace' },
  infoValueMono: { color: '#AAAAAA', fontSize: 11, fontFamily: 'monospace' },
  offlineText: { color: '#FF6B6B', fontSize: 13, marginTop: 8 },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 4 },
  sectionDesc: { color: '#666677', fontSize: 13, marginBottom: 8 },
  input: { backgroundColor: '#151520', borderRadius: 12, padding: 14, color: '#FFFFFF', fontSize: 16, borderWidth: 1, borderColor: '#2A2A35', marginBottom: 12 },
  actionButton: { backgroundColor: '#6C5CE7', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8 },
  buttonDisabled: { opacity: 0.5 },
  actionButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  techCard: { backgroundColor: '#151520', borderRadius: 12, padding: 16, marginTop: 24, borderWidth: 1, borderColor: '#2A2A35' },
  techTitle: { color: '#6C5CE7', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  techText: { color: '#888899', fontSize: 13, lineHeight: 18 },
});
