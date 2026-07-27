/**
 * useBiometric hook — Biometric authentication management.
 */

import { useState, useEffect, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { loadSetting, saveSetting } from '../services/wallet';

const BIOMETRIC_KEY = '@hsmc/biometric_enabled';

export function useBiometric() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('biometric');

  useEffect(() => {
    // Check biometric availability
    if (Platform.OS === 'ios') {
      setIsAvailable(true);
      setBiometricType('Face ID / Touch ID');
    } else if (Platform.OS === 'android') {
      setIsAvailable(true);
      setBiometricType('Fingerprint');
    }

    // Load saved preference
    loadSetting(BIOMETRIC_KEY).then(val => {
      if (val === 'true') setIsEnabled(true);
    });
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    try {
      // Would call react-native-biometrics createSignature()
      await saveSetting(BIOMETRIC_KEY, 'true');
      setIsEnabled(true);
      return true;
    } catch {
      Alert.alert('Error', 'Failed to enable biometric authentication.');
      return false;
    }
  }, []);

  const disable = useCallback(async (): Promise<boolean> => {
    try {
      await saveSetting(BIOMETRIC_KEY, 'false');
      setIsEnabled(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  const authenticate = useCallback(async (reason: string = 'Authenticate to continue'): Promise<boolean> => {
    if (!isEnabled) return true;
    try {
      // Would call react-native-biometrics simplePrompt({promptMessage: reason})
      return true;
    } catch {
      return false;
    }
  }, [isEnabled]);

  return { isAvailable, isEnabled, biometricType, enable, disable, authenticate };
}
