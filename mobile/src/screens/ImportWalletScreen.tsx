/**
 * ImportWalletScreen — Import existing wallet from seed phrase or private key.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  TextInput, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { validateMnemonic, deriveAddress, deriveStealthAddress,
  encryptMnemonic, saveWallet } from '../services/wallet';
import { createWallet, apiRegister } from '../services/api';
import { useAppStore } from '../store/appStore';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'ImportWallet'> };

export default function ImportWalletScreen({ navigation }: Props): React.JSX.Element {
  const login = useAppStore((s) => s.login);
  const [seedInput, setSeedInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [walletLabel, setWalletLabel] = useState('Imported Wallet');
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    const cleaned = seedInput.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(cleaned)) {
      Alert.alert('Invalid Seed Phrase', 'Please check your seed phrase and try again. Must be 12 or 24 valid BIP39 words.');
      return;
    }
    if (!password || password.length < 8) {
      Alert.alert('Weak Password', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const address = await deriveAddress(cleaned);
      const stealthAddress = await deriveStealthAddress(cleaned);
      const encryptedSeed = await encryptMnemonic(cleaned, password);

      await saveWallet({
        mnemonic: cleaned,
        address,
        stealthAddress,
        encryptedSeed,
        label: walletLabel,
        createdAt: new Date().toISOString(),
      });

      try {
        const email = `wallet-${address.slice(2, 10)}@hsmc.local`;
        const result = await apiRegister(email, password, address);
        await createWallet({
          user_id: result.user_id, address, label: walletLabel, is_primary: true,
        });
        login(result.token, result.user_id);
      } catch {
        login('local-token', address);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to import wallet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Import Wallet</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Seed Phrase or Private Key</Text>
        <Text style={styles.helpText}>
          Enter your 12 or 24-word seed phrase. Words should be separated by spaces.
        </Text>
        <TextInput
          style={[styles.input, styles.seedInput]}
          value={seedInput}
          onChangeText={setSeedInput}
          placeholder="Enter seed phrase..."
          placeholderTextColor="#555566"
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.sectionTitle}>Wallet Label</Text>
        <TextInput
          style={styles.input}
          value={walletLabel}
          onChangeText={setWalletLabel}
          placeholder="e.g., My Imported Wallet"
          placeholderTextColor="#555566"
        />

        <Text style={styles.sectionTitle}>Set Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Minimum 8 characters"
          placeholderTextColor="#555566"
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm password"
          placeholderTextColor="#555566"
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.importButton, loading && styles.buttonDisabled]}
          onPress={handleImport}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> :
            <Text style={styles.importButtonText}>Import Wallet</Text>}
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
  sectionTitle: { color: '#888899', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  helpText: { color: '#666677', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  input: { backgroundColor: '#151520', borderRadius: 12, padding: 14, color: '#FFFFFF', fontSize: 16, borderWidth: 1, borderColor: '#2A2A35', marginTop: 8 },
  seedInput: { minHeight: 100, textAlignVertical: 'top', fontFamily: 'monospace' },
  importButton: { backgroundColor: '#6C5CE7', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 32 },
  buttonDisabled: { opacity: 0.5 },
  importButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
