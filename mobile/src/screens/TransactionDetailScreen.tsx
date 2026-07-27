/**
 * TransactionDetailScreen — Full transaction details.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, ActivityIndicator } from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { queryTable } from '../services/api';
import type { TransactionRow } from '../services/api';

type Props = {
  navigation: StackNavigationProp<RootStackParamList, 'TransactionDetail'>;
  route: { params: { txId: string } };
};

export default function TransactionDetailScreen({ navigation, route }: Props): React.JSX.Element {
  const { txId } = route.params;
  const [tx, setTx] = useState<TransactionRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queryTable<TransactionRow>('transactions', { filters: { id: txId }, limit: 1 })
      .then(rows => { setTx(rows[0] || null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [txId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#6C5CE7" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!tx) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>{'< Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Transaction</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Transaction not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusColors: Record<string, string> = { pending: '#FFB74D', confirmed: '#00C853', failed: '#FF5252' };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transaction Details</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusCard}>
          <Text style={[styles.statusText, { color: statusColors[tx.status] || '#888' }]}>
            {tx.status.toUpperCase()}
          </Text>
          <Text style={styles.amountText}>
            {tx.amount.toFixed(4)} HSMC
          </Text>
        </View>

        <View style={styles.detailCard}>
          <DetailRow label="Transaction Hash" value={tx.hash} mono />
          <DetailDivider />
          <DetailRow label="From" value={tx.from_address} mono />
          <DetailDivider />
          <DetailRow label="To" value={tx.to_address} mono />
          <DetailDivider />
          <DetailRow label="Amount" value={`${tx.amount.toFixed(4)} HSMC`} />
          <DetailDivider />
          <DetailRow label="Fee" value={`${tx.fee.toFixed(6)} HSMC`} />
          <DetailDivider />
          <DetailRow label="Privacy Level" value={tx.privacy_level} />
          <DetailDivider />
          <DetailRow label="Status" value={tx.status} />
          <DetailDivider />
          <DetailRow label="Created" value={new Date(tx.created_at).toLocaleString()} />
          {tx.confirmed_at && (
            <>
              <DetailDivider />
              <DetailRow label="Confirmed" value={new Date(tx.confirmed_at).toLocaleString()} />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.mono]} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

function DetailDivider() {
  return <View style={styles.detailDivider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E2E' },
  backButton: { color: '#6C5CE7', fontSize: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  content: { padding: 16 },
  statusCard: { backgroundColor: '#151520', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#2A2A35' },
  statusText: { fontSize: 16, fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  amountText: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', fontFamily: 'monospace' },
  detailCard: { backgroundColor: '#151520', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2A2A35' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  detailLabel: { color: '#888899', fontSize: 13, flex: 0.35 },
  detailValue: { color: '#FFFFFF', fontSize: 13, flex: 0.65, textAlign: 'right' },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  detailDivider: { height: 1, backgroundColor: '#2A2A35' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: '#555566', fontSize: 14 },
});
