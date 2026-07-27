/**
 * CreateWalletScreen — Generate new BIP39 wallet with 24-word seed phrase.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import {
  generateMnemonic,
  generateMnemonic12,
  deriveAddress,
  deriveStealthAddress,
  encryptMnemonic,
  saveWallet,
} from '../services/wallet';
import { createWallet, apiRegister } from '../services/api';
import { useAppStore } from '../store/appStore';

type Props = {
  navigation: StackNavigationProp<RootStackParamList, 'CreateWallet'>;
};

export default function CreateWalletScreen({ navigation }: Props): React.JSX.Element {
  const login = useAppStore((s) => s.login);
  const [step, setStep] = useState<'generate' | 'password'>('generate');
  const [mnemonic, setMnemonic] = useState('');
  const [wordCount, setWordCount] = useState<'24' | '12'>('24');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [walletLabel, setWalletLabel] = useState('My HSMC Wallet');
  const [loading, setLoading] = useState(false);
  const [hasSavedSeed, setHasSavedSeed] = useState(false);

  const handleGenerate = () => {
    const mnem = wordCount === '24' ? generateMnemonic() : generateMnemonic12();
    setMnemonic(mnem);
    setStep('password');
  };

  const handleCreate = async () => {
    if (!password || password.length < 8) {
      Alert.alert('Weak Password', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    if (!hasSavedSeed) {
      Alert.alert(
        'Save Your Seed Phrase',
        'You must confirm you have safely stored your seed phrase before continuing.'
      );
      return;
    }

    setLoading(true);
    try {
      // Derive wallet address and encrypt seed
      const address = await deriveAddress(mnemonic);
      const stealthAddress = await deriveStealthAddress(mnemonic);
      const encryptedSeed = await encryptMnemonic(mnemonic, password);

      // Save wallet locally
      await saveWallet({
        mnemonic,
        address,
        stealthAddress,
        encryptedSeed,
        label: walletLabel,
        createdAt: new Date().toISOString(),
      });

      // Register on backend
      try {
        const email = `wallet-${address.slice(2, 10)}@hsmc.local`;
        const result = await apiRegister(email, password, address);

        // Create wallet in database
        await createWallet({
          user_id: result.user_id,
          address,
          label: walletLabel,
          is_primary: true,
        });

        login(result.token, result.user_id);
      } catch (apiError) {
        // Backend might not be available; still allow wallet creation
        console.warn('Backend registration failed, using offline mode:', apiError);
        // Use local auth
        login('local-token', address);
      }

      // Navigate to seed confirmation (user must verify they saved it)
      navigation.navigate('SeedPhraseConfirmation', { mnemonic, password });
    } catch (error) {
      Alert.alert('Error', 'Failed to create wallet. Please try again.');
      console.error('Wallet creation error:', error);
    } finally {
      setLoading(false);
    }
  };

  const mnemonicWords = mnemonic.split(' ');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Wallet</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {step === 'generate' ? (
          <>
            <Text style={styles.sectionTitle}>Select Seed Phrase Length</Text>
            <View style={styles.wordCountContainer}>
              <TouchableOpacity
                style={[styles.wordCountButton, wordCount === '24' && styles.wordCountActive]}
                onPress={() => setWordCount('24')}
              >
                <Text style={[styles.wordCountText, wordCount === '24' && styles.wordCountTextActive]}>
                  24 Words
                </Text>
                <Text style={styles.wordCountSub}>256-bit security</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.wordCountButton, wordCount === '12' && styles.wordCountActive]}
                onPress={() => setWordCount('12')}
              >
                <Text style={[styles.wordCountText, wordCount === '12' && styles.wordCountTextActive]}>
                  12 Words
                </Text>
                <Text style={styles.wordCountSub}>128-bit security</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Wallet Label</Text>
            <TextInput
              style={styles.input}
              value={walletLabel}
              onChangeText={setWalletLabel}
              placeholder="e.g., My HSMC Wallet"
              placeholderTextColor="#555566"
            />

            <TouchableOpacity style={styles.generateButton} onPress={handleGenerate}>
              <Text style={styles.generateButtonText}>Generate Seed Phrase</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.warningTitle}>⚠️ Your Seed Phrase</Text>
            <Text style={styles.warningText}>
              Write down these {wordCount} words in order. Store them securely offline.
              Never share your seed phrase. Anyone with these words can access your funds.
            </Text>

            {/* Seed phrase grid */}
            <View style={styles.seedGrid}>
              {mnemonicWords.map((word, idx) => (
                <View key={idx} style={styles.seedWord}>
                  <Text style={styles.seedIndex}>{idx + 1}</Text>
                  <Text style={styles.seedWordText}>{word}</Text>
                </View>
              ))}
            </View>

            {/* Save confirmation */}
            <TouchableOpacity
              style={[styles.saveCheck, hasSavedSeed && styles.saveChecked]}
              onPress={() => setHasSavedSeed(!hasSavedSeed)}
            >
              <View style={[styles.checkbox, hasSavedSeed && styles.checkboxChecked]}>
                {hasSavedSeed && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.saveCheckText}>
                I have safely stored my seed phrase
              </Text>
            </TouchableOpacity>

            {/* Password */}
            <Text style={styles.sectionTitle}>Set Wallet Password</Text>
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
              style={[styles.createButton, loading && styles.buttonDisabled]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.createButtonText}>Create Wallet</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E2E',
  },
  backButton: { color: '#6C5CE7', fontSize: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  content: { padding: 24, paddingBottom: 60 },
  sectionTitle: {
    color: '#888899',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
  },
  wordCountContainer: { flexDirection: 'row', gap: 12 },
  wordCountButton: {
    flex: 1,
    backgroundColor: '#151520',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2A2A35',
  },
  wordCountActive: { borderColor: '#6C5CE7', backgroundColor: '#1A1540' },
  wordCountText: { color: '#888899', fontSize: 16, fontWeight: '600' },
  wordCountTextActive: { color: '#6C5CE7' },
  wordCountSub: { color: '#555566', fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: '#151520',
    borderRadius: 12,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2A35',
    marginTop: 8,
  },
  generateButton: {
    backgroundColor: '#6C5CE7',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 32,
  },
  generateButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  warningTitle: { color: '#FF6B6B', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  warningText: { color: '#888899', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  seedGrid: {
    backgroundColor: '#151520',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A35',
    marginBottom: 16,
  },
  seedWord: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E2E',
  },
  seedIndex: { color: '#555566', fontSize: 12, width: 28, textAlign: 'right', marginRight: 12 },
  seedWordText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'monospace' },
  saveCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    padding: 8,
  },
  saveChecked: {},
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#555566',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#6C5CE7', borderColor: '#6C5CE7' },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  saveCheckText: { color: '#888899', fontSize: 14, flex: 1 },
  createButton: {
    backgroundColor: '#6C5CE7',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.5 },
  createButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
