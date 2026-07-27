/**
 * SendScreen — Send HSMC tokens to an address.
 * Supports QR code scanning and address entry.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  TextInput, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import { sendTransaction } from '../services/api';
import { loadWallet, decryptMnemonic } from '../services/wallet';
import { signTransaction } from '../services/crypto';
import { notifyTransactionSent } from '../services/notifications';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Send'> };

export default function SendScreen({ navigation }: Props): React.JSX.Element {
  const { wallet, balance, userId } = useAppStore();
  const updateBalance = useAppStore((s) => s.updateBalance);

  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [privacyLevel, setPrivacyLevel] = useState<'standard' | 'shielded'>('standard');
  const [fee, setFee] = useState(0.001);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [password, setPassword] = useState('');

  useEffect(() => {
    // Dynamic fee: 0.1% of amount or minimum 0.001
    const amt = parseFloat(amount);
    if (!isNaN(amt) && amt > 0) {
      setFee(Math.max(0.001, amt * 0.001));
    }
  }, [amount]);

  const handleReview = () => {
    if (!toAddress.trim()) {
      Alert.alert('Invalid Address', 'Please enter a valid HSMC address.');
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    if (amt + fee > balance) {
      Alert.alert('Insufficient Balance', `You need ${(amt + fee).toFixed(4)} HSMC but only have ${balance.toFixed(4)}.`);
      return;
    }
    setStep('review');
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const amt = parseFloat(amount);
      const storedWallet = await loadWallet();
      if (!storedWallet || !wallet) throw new Error('No wallet');

      // Decrypt seed and sign transaction
      const mnemonic = await decryptMnemonic(storedWallet.encryptedSeed, password);

      // Derive keypair and sign
      const { signTransaction: signTx } = await import('../services/crypto');
      const { deriveKeyPair } = await import('../services/crypto');
      const keyPair = await deriveKeyPair(mnemonic);

      const signed = await signTx(
        {
          from: wallet.address,
          to: toAddress.trim(),
          amount: amt,
          fee,
          nonce: Date.now(),
          privacyLevel,
        },
        keyPair.privateKey
      );

      // Submit to backend
      const tx = await sendTransaction({
        from_address: wallet.address,
        to_address: toAddress.trim(),
        amount: amt,
        fee,
        privacy_level: privacyLevel,
      });

      // Update balance locally
      updateBalance(balance - amt - fee, wallet.staked_balance);

      // Notify
      notifyTransactionSent(amt, toAddress.trim(), tx.hash);

      Alert.alert('Transaction Sent', `${amt.toFixed(4)} HSMC sent successfully!`, [
        { text: 'Done', onPress: () => navigation.navigate('Dashboard') },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to send transaction. Please try again.');
      console.error('Send error:', error);
    } finally {
      setLoading(false);
      setPassword('');
    }
  };

  if (step === 'review') {
    const amt = parseFloat(amount) || 0;
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep('input')}>
            <Text style={styles.backButton}>{'< Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Confirm Send</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView contentContainerStyle={styles.reviewContent}>
          <View style={styles.reviewCard}>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>To</Text>
              <Text style={styles.reviewValue} numberOfLines={2}>{toAddress.trim()}</Text>
            </View>
            <View style={styles.reviewDivider} />
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Amount</Text>
              <Text style={styles.reviewValueLarge}>{amt.toFixed(4)} HSMC</Text>
            </View>
            <View style={styles.reviewDivider} />
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Fee</Text>
              <Text style={styles.reviewValue}>{fee.toFixed(4)} HSMC</Text>
            </View>
            <View style={styles.reviewDivider} />
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Privacy</Text>
              <Text style={styles.reviewValue}>{privacyLevel}</Text>
            </View>
            <View style={styles.reviewDivider} />
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Total</Text>
              <Text style={styles.reviewTotal}>{(amt + fee).toFixed(4)} HSMC</Text>
            </View>
          </View>

          <Text style={styles.passwordLabel}>Enter wallet password to confirm</Text>
          <TextInput
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            placeholder="Wallet password"
            placeholderTextColor="#555566"
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.confirmButton, loading && styles.buttonDisabled]}
            onPress={handleConfirm}
            disabled={loading || !password}
          >
            {loading ? <ActivityIndicator color="#FFFFFF" /> :
              <Text style={styles.confirmButtonText}>Confirm & Send</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send HSMC</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.balanceInfo}>
          Balance: {balance.toFixed(4)} HSMC
          (≈ ${(wallet ? balance * (useAppStore.getState().tokenMetrics?.price || 0) : 0).toFixed(2)})
        </Text>

        <Text style={styles.label}>Recipient Address</Text>
        <TextInput
          style={styles.input}
          value={toAddress}
          onChangeText={setToAddress}
          placeholder="0x... or HSMCst..."
          placeholderTextColor="#555566"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.qrButton}>
          <Text style={styles.qrButtonText}>📷 Scan QR Code</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Amount (HSMC)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          placeholderTextColor="#555566"
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Privacy Level</Text>
        <View style={styles.privacyRow}>
          <TouchableOpacity
            style={[styles.privacyOption, privacyLevel === 'standard' && styles.privacyActive]}
            onPress={() => setPrivacyLevel('standard')}
          >
            <Text style={[styles.privacyText, privacyLevel === 'standard' && styles.privacyTextActive]}>
              Standard
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.privacyOption, privacyLevel === 'shielded' && styles.privacyActive]}
            onPress={() => setPrivacyLevel('shielded')}
          >
            <Text style={[styles.privacyText, privacyLevel === 'shielded' && styles.privacyTextActive]}>
              🔒 Shielded
            </Text>
          </TouchableOpacity>
        </View>

        {parseFloat(amount) > 0 && (
          <View style={styles.feeInfo}>
            <Text style={styles.feeText}>Network fee: {fee.toFixed(4)} HSMC</Text>
            <Text style={styles.feeText}>Total: {(parseFloat(amount) + fee).toFixed(4)} HSMC</Text>
          </View>
        )}

        <TouchableOpacity style={styles.reviewButton} onPress={handleReview}>
          <Text style={styles.reviewButtonText}>Review Transaction</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E2E' },
  backButton: { color: '#6C5CE7', fontSize: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  content: { padding: 24, paddingBottom: 60 },
  balanceInfo: { color: '#888899', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  label: { color: '#888899', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: '#151520', borderRadius: 12, padding: 14, color: '#FFFFFF', fontSize: 16, borderWidth: 1, borderColor: '#2A2A35' },
  qrButton: { backgroundColor: '#151520', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#2A2A35' },
  qrButtonText: { color: '#888899', fontSize: 14 },
  privacyRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  privacyOption: { flex: 1, backgroundColor: '#151520', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 2, borderColor: '#2A2A35' },
  privacyActive: { borderColor: '#6C5CE7', backgroundColor: '#1A1540' },
  privacyText: { color: '#888899', fontSize: 14, fontWeight: '600' },
  privacyTextActive: { color: '#6C5CE7' },
  feeInfo: { backgroundColor: '#151520', borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#2A2A35' },
  feeText: { color: '#888899', fontSize: 13, marginTop: 4 },
  reviewButton: { backgroundColor: '#6C5CE7', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  reviewButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  reviewContent: { padding: 24, paddingBottom: 60 },
  reviewCard: { backgroundColor: '#151520', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2A2A35', marginBottom: 20 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  reviewDivider: { height: 1, backgroundColor: '#2A2A35', marginVertical: 4 },
  reviewLabel: { color: '#888899', fontSize: 14 },
  reviewValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right', fontFamily: 'monospace' },
  reviewValueLarge: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', fontFamily: 'monospace' },
  reviewTotal: { color: '#6C5CE7', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  passwordLabel: { color: '#888899', fontSize: 13, marginBottom: 8 },
  passwordInput: { backgroundColor: '#151520', borderRadius: 12, padding: 14, color: '#FFFFFF', fontSize: 16, borderWidth: 1, borderColor: '#2A2A35', marginBottom: 16, textAlign: 'center' },
  confirmButton: { backgroundColor: '#6C5CE7', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  confirmButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
