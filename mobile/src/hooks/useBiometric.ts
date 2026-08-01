/**
 * useBiometric hook — Biometric authentication via react-native-biometrics.
 * Real device sensor integration: availability check, key creation,
 * simplePrompt authentication, and persistent enable/disable.
 */

import { useState, useEffect, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { loadSetting, saveSetting } from '../services/wallet';

const BIOMETRIC_KEY = '@hsmc/biometric_enabled';
const BIOMETRIC_REQUIRE_SEND_KEY = '@hsmc/biometric_require_send';

const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

function biometryTypeLabel(type: string | null): string {
  switch (type) {
    case BiometryTypes.Biometrics:
      return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
    case BiometryTypes.FaceID:
      return 'Face ID';
    case BiometryTypes.Face:
      return 'Face Unlock';
    case BiometryTypes.Iris:
      return 'Iris';
    case BiometryTypes.TouchID:
      return 'Touch ID';
    default:
      return 'Biometric';
  }
}

export function useBiometric() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [requireForSend, setRequireForSendState] = useState(true);
  const [biometricType, setBiometricType] = useState<string>('Biometric');
  const [keysExist, setKeysExist] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const { available, biometryType } = await rnBiometrics.isSensorAvailable();
        if (!mounted) return;
        setIsAvailable(available);
        if (available && biometryType) {
          setBiometricType(biometryTypeLabel(biometryType));
        }
        const exists = await rnBiometrics.biometricKeysExist();
        if (mounted) setKeysExist(exists.keysExist);
      } catch {
        if (mounted) {
          setIsAvailable(false);
          setBiometricType('Biometric');
        }
      }

      const [enabledVal, requireSendVal] = await Promise.all([
        loadSetting(BIOMETRIC_KEY),
        loadSetting(BIOMETRIC_REQUIRE_SEND_KEY),
      ]);
      if (!mounted) return;
      setIsEnabled(enabledVal === 'true');
      setRequireForSendState(requireSendVal !== 'false');
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  /** Enable biometric unlock: create signing keys and persist the preference. */
  const enable = useCallback(async (): Promise<boolean> => {
    try {
      const { available } = await rnBiometrics.isSensorAvailable();
      if (!available) {
        Alert.alert(
          'Biometrics Unavailable',
          'No fingerprint, face, or iris sensor was found on this device.'
        );
        return false;
      }
      const { keysExist: exist } = await rnBiometrics.biometricKeysExist();
      if (!exist) {
        await rnBiometrics.createKeys();
      }
      const { keysExist: created } = await rnBiometrics.biometricKeysExist();
      if (!created) {
        Alert.alert('Setup Failed', 'Could not create biometric signing keys.');
        return false;
      }
      await saveSetting(BIOMETRIC_KEY, 'true');
      setIsEnabled(true);
      setKeysExist(true);
      return true;
    } catch (error) {
      console.error('Biometric enable error:', error);
      Alert.alert('Error', 'Failed to enable biometric authentication.');
      return false;
    }
  }, []);

  /** Disable biometric unlock and delete the signing keys. */
  const disable = useCallback(async (): Promise<boolean> => {
    try {
      await rnBiometrics.deleteKeys();
      await saveSetting(BIOMETRIC_KEY, 'false');
      setIsEnabled(false);
      setKeysExist(false);
      return true;
    } catch (error) {
      console.error('Biometric disable error:', error);
      return false;
    }
  }, []);

  /**
   * Prompt the user with the system biometric dialog.
   * Returns true only when the sensor authenticates successfully.
   */
  const authenticate = useCallback(
    async (reason: string = 'Authenticate to continue'): Promise<boolean> => {
      if (!isEnabled) return true;
      try {
        const { success } = await rnBiometrics.simplePrompt({
          promptMessage: reason,
          cancelButtonText: 'Use password',
        });
        return success;
      } catch {
        return false;
      }
    },
    [isEnabled]
  );

  /**
   * Sign a payload with the biometric key (used to authorize transactions
   * with a cryptographic proof instead of only a UI prompt).
   */
  const signWithBiometrics = useCallback(
    async (payload: string): Promise<string | null> => {
      try {
        const { success, signature } = await rnBiometrics.createSignature({
          promptMessage: 'Authorize this transaction',
          payload,
        });
        return success && signature ? signature : null;
      } catch {
        return null;
      }
    },
    []
  );

  /** Set whether transactions must be confirmed with biometrics. */
  const setRequireForSend = useCallback(async (value: boolean): Promise<void> => {
    setRequireForSendState(value);
    await saveSetting(BIOMETRIC_REQUIRE_SEND_KEY, String(value));
  }, []);

  return {
    isAvailable,
    isEnabled,
    requireForSend,
    biometricType,
    keysExist,
    enable,
    disable,
    authenticate,
    signWithBiometrics,
    setRequireForSend,
  };
}
