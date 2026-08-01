/**
 * LoginScreen — Unlock wallet with password or biometric auth.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { loadWallet, decryptMnemonic, loadAuthData } from '../services/wallet';
import { useAppStore } from '../store/appStore';
import { apiLogin } from '../services/api';
import { useBiometric } from '../hooks/useBiometric';
import { clearAllWalletData } from '../services/wallet';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Login'> };

export default function LoginScreen({ navigation }: Props): React.JSX.Element {
  const login = useAppStore((s) => s.login);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { isAvailable: biometricAvailable, isEnabled: biometricEnabled, authenticate } = useBiometric();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    loadWallet().then(w => {
      if (w) setWalletAddress(w.address);
    });
    // Sensor availability and saved preference are provided by useBiometric.
  }, []);

  const handleUnlock = async () => {
    if (!password) {
      Alert.alert('Enter Password', 'Please enter your wallet password.');
      return;
    }

    setLoading(true);
    try {
      const wallet = await loadWallet();
      if (!wallet) {
        Alert.alert('No Wallet', 'No wallet found. Please create or import one.');
        setLoading(false);
        return;
      }

      // Try to decrypt the seed phrase
      await decryptMnemonic(wallet.encryptedSeed, password);

      // Try backend auth
      try {
        const auth = await loadAuthData();
        if (auth) {
          login(auth.token, auth.userId);
        } else {
          login('local-token', wallet.address);
        }
      } catch {
        login('local-token', wallet.address);
      }
    } catch {
      Alert.alert('Wrong Password', 'The password you entered is incorrect.');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricUnlock = async () => {
    const ok = await authenticate('Unlock your HSMC wallet');
    if (!ok) return;
    const wallet = await loadWallet();
    if (!wallet) return;
    const auth = await loadAuthData();
    login(auth?.token || 'local-token', auth?.userId || wallet.address);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>H</Text>
        </View>
        <Text style={styles.title}>Unlock Wallet</Text>

        {walletAddress && (
          <Text style={styles.addressText}>
            {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
          </Text>
        )}

        <TextInput
          style={styles.passwordInput}
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          placeholderTextColor="#555566"
          secureTextEntry
          autoFocus
        />

        <TouchableOpacity
          style={[styles.unlockButton, loading && styles.buttonDisabled]}
          onPress={handleUnlock}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> :
            <Text style={styles.unlockButtonText}>Unlock</Text>}
        </TouchableOpacity>

        {biometricAvailable && biometricEnabled && (
          <TouchableOpacity style={styles.biometricButton} onPress={handleBiometricUnlock}>
            <Text style={styles.biometricButtonText}>🔐 Unlock with Biometrics</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.resetButton}
          onPress={() => Alert.alert(
            'Reset Wallet',
            'This will remove your wallet from this device. You will need your seed phrase to recover.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => {
                clearAllWalletData().then(() => navigation.navigate('Welcome')).catch(() =>
                  Alert.alert('Reset failed', 'Wallet data could not be removed.'));
              }},
            ]
          )}
        >
          <Text style={styles.resetText}>Reset Wallet</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#6C5CE7',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  logoText: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  addressText: { color: '#888899', fontSize: 13, fontFamily: 'monospace', marginBottom: 24 },
  passwordInput: {
    width: '100%', backgroundColor: '#151520', borderRadius: 12, padding: 16,
    color: '#FFFFFF', fontSize: 16, borderWidth: 1, borderColor: '#2A2A35',
    marginBottom: 20, textAlign: 'center',
  },
  unlockButton: {
    width: '100%', backgroundColor: '#6C5CE7', paddingVertical: 16,
    borderRadius: 12, alignItems: 'center', marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  unlockButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  biometricButton: {
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12,
    backgroundColor: '#151520', borderWidth: 1, borderColor: '#2A2A35',
  },
  biometricButtonText: { color: '#888899', fontSize: 14 },
  resetButton: { marginTop: 40, padding: 12 },
  resetText: { color: '#FF6B6B', fontSize: 14 },
});
