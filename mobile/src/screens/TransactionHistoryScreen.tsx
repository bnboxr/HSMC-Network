/**
 * TransactionHistoryScreen — List of all sent/received transactions.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import { getTransactions } from '../services/api';
import type { TransactionRow } from '../services/api';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'TransactionHistory'> };

export default function TransactionHistoryScreen({ navigation }: Props): React.JSX.Element {
  const wallet = useAppStore((s) => s.wallet);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTxs = useCallback(async () => {
    if (!wallet) return;
    try {
      const txs = await getTransactions(wallet.address, 50);
      setTransactions(txs);
    } catch (error) {
      console.error('Fetch transactions error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [wallet]);

  useEffect(() => { fetchTxs(); }, []);

  const renderTx = ({ item }: { item: TransactionRow }) => {
    const isSent = wallet && item.from_address.toLowerCase() === wallet.address.toLowerCase();
    const statusColors: Record<string, string> = {
      pending: '#FFB74D',
      confirmed: '#00C853',
      failed: '#FF5252',
    };

    return (
      <TouchableOpacity
        style={styles.txRow}
        onPress={() => navigation.navigate('TransactionDetail', { txId: item.id })}
      >
        <View style={[styles.txIcon, { backgroundColor: isSent ? '#FF525220' : '#00C85320' }]}>
          <Text style={{ color: isSent ? '#FF5252' : '#00C853', fontSize: 16 }}>
            {isSent ? '↑' : '↓'}
          </Text>
        </View>
        <View style={styles.txInfo}>
          <Text style={styles.txAddress} numberOfLines={1}>
            {isSent ? 'To: ' : 'From: '}
            {(isSent ? item.to_address : item.from_address).slice(0, 12)}...
          </Text>
          <View style={styles.txMeta}>
            <Text style={styles.txDate}>
              {new Date(item.created_at).toLocaleDateString()}
            </Text>
            <View style={[styles.statusDot, { backgroundColor: statusColors[item.status] || '#888' }]} />
            <Text style={[styles.txStatus, { color: statusColors[item.status] || '#888' }]}>
              {item.status}
            </Text>
          </View>
        </View>
        <View style={styles.txAmount}>
          <Text style={[styles.txAmountText, { color: isSent ? '#FF5252' : '#00C853' }]}>
            {isSent ? '-' : '+'}{item.amount.toFixed(4)} HSMC
          </Text>
          {item.privacy_level !== 'standard' && (
            <Text style={styles.privacyBadge}>🔒 {item.privacy_level}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transactions</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#6C5CE7" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={transactions}
          renderItem={renderTx}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTxs(); }} tintColor="#6C5CE7" />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>No transactions yet</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E2E' },
  backButton: { color: '#6C5CE7', fontSize: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  listContent: { padding: 16 },
  txRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#151520', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#2A2A35' },
  txIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  txInfo: { flex: 1, marginLeft: 12 },
  txAddress: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  txMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  txDate: { color: '#555566', fontSize: 11 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  txStatus: { fontSize: 11, textTransform: 'capitalize' },
  txAmount: { alignItems: 'flex-end' },
  txAmountText: { fontSize: 14, fontWeight: '600', fontFamily: 'monospace' },
  privacyBadge: { fontSize: 9, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: { color: '#555566', fontSize: 14 },
});
