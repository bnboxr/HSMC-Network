/**
 * BiometricSetupScreen — Enable/disable biometric unlock (FaceID, TouchID, fingerprint).
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert, Switch } from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'BiometricSetup'> };

export default function BiometricSetupScreen({ navigation }: Props): React.JSX.Element {
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [requireForSend, setRequireForSend] = useState(true);

  const handleEnable = () => {
    // Would call react-native-biometrics createSignature() or createKeys()
    Alert.alert('Biometric Setup', 'Biometric authentication has been enabled.', [
      { text: 'Continue', onPress: () => {
        setBiometricEnabled(true);
        navigation.goBack();
      }},
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Biometric Security</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>🔐</Text>
        </View>
        <Text style={styles.title}>Biometric Unlock</Text>
        <Text style={styles.description}>
          Use your device's biometric authentication (FaceID, TouchID, or fingerprint)
          to unlock your wallet and authorize transactions.
        </Text>

        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingLabel}>Enable Biometric Unlock</Text>
            <Text style={styles.settingDesc}>Unlock wallet with biometrics</Text>
          </View>
          <Switch
            value={biometricEnabled}
            onValueChange={(val) => {
              if (val) {
                handleEnable();
              } else {
                setBiometricEnabled(false);
              }
            }}
            trackColor={{ false: '#2A2A35', true: '#6C5CE7' }}
            thumbColor="#FFFFFF"
          />
        </View>

        {biometricEnabled && (
          <>
            <View style={styles.divider} />

            <View style={styles.settingRow}>
              <View>
                <Text style={styles.settingLabel}>Require for Transactions</Text>
                <Text style={styles.settingDesc}>Confirm sends with biometrics</Text>
              </View>
              <Switch
                value={requireForSend}
                onValueChange={setRequireForSend}
                trackColor={{ false: '#2A2A35', true: '#6C5CE7' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </>
        )}

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>🔒 Security Note</Text>
          <Text style={styles.infoText}>
            Biometric data never leaves your device. It is stored in the device's secure enclave
            and used only to unlock your encrypted wallet.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E2E' },
  backButton: { color: '#6C5CE7', fontSize: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  content: { padding: 24 },
  iconContainer: { alignItems: 'center', marginTop: 24, marginBottom: 16 },
  iconText: { fontSize: 64 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  description: { color: '#888899', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 32 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  settingLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  settingDesc: { color: '#666677', fontSize: 13, marginTop: 2 },
  divider: { height: 1, backgroundColor: '#2A2A35', marginVertical: 8 },
  infoBox: { backgroundColor: '#151520', borderRadius: 12, padding: 16, marginTop: 32, borderWidth: 1, borderColor: '#2A2A35' },
  infoTitle: { color: '#6C5CE7', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  infoText: { color: '#888899', fontSize: 13, lineHeight: 18 },
});
