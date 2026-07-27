/**
 * ReceiveScreen — Display QR code with wallet address for receiving funds.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Share, Alert } from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Receive'> };

export default function ReceiveScreen({ navigation }: Props): React.JSX.Element {
  const wallet = useAppStore((s) => s.wallet);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (wallet) {
      // Would use Clipboard.setString(wallet.address)
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (wallet) {
      try {
        await Share.share({
          message: `My HSMC address: ${wallet.address}`,
          title: 'HSMC Wallet Address',
        });
      } catch (error) {
        console.error('Share error:', error);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Receive HSMC</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.qrContainer}>
          {/* QR code placeholder - would use react-native-qrcode-svg */}
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrPlaceholderText}>QR Code</Text>
            <Text style={styles.qrPlaceholderSub}>{wallet?.address?.slice(0, 12)}...</Text>
          </View>
        </View>

        <Text style={styles.addressLabel}>Your HSMC Address</Text>

        <View style={styles.addressCard}>
          <Text style={styles.addressText} selectable>
            {wallet?.address || 'No wallet loaded'}
          </Text>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleCopy}>
            <Text style={styles.actionText}>{copied ? '✓ Copied' : '📋 Copy'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Text style={styles.actionText}>📤 Share</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>ℹ️ Supported Networks</Text>
          <Text style={styles.infoText}>
            Send HSMC (native) or wHSMC on BSC, Ethereum, and Polygon to this address.
            The HSMC Network supports cross-chain bridging.
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
  content: { flex: 1, alignItems: 'center', padding: 24, paddingTop: 40 },
  qrContainer: { marginBottom: 32 },
  qrPlaceholder: {
    width: 200, height: 200, backgroundColor: '#FFFFFF', borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  qrPlaceholderText: { color: '#0A0A0F', fontSize: 18, fontWeight: '700' },
  qrPlaceholderSub: { color: '#555566', fontSize: 10, marginTop: 4, fontFamily: 'monospace' },
  addressLabel: { color: '#888899', fontSize: 13, textTransform: 'uppercase', marginBottom: 8 },
  addressCard: {
    backgroundColor: '#151520', borderRadius: 12, padding: 16, width: '100%',
    borderWidth: 1, borderColor: '#2A2A35',
  },
  addressText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'monospace', textAlign: 'center', lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: 16, marginTop: 20 },
  actionButton: {
    backgroundColor: '#151520', paddingVertical: 12, paddingHorizontal: 24,
    borderRadius: 12, borderWidth: 1, borderColor: '#2A2A35',
  },
  actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  infoBox: {
    backgroundColor: '#151520', borderRadius: 12, padding: 16, marginTop: 32,
    width: '100%', borderWidth: 1, borderColor: '#2A2A35',
  },
  infoTitle: { color: '#6C5CE7', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  infoText: { color: '#888899', fontSize: 13, lineHeight: 18 },
});
