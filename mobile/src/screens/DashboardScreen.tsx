/**
 * DashboardScreen — Main wallet dashboard with balance, recent transactions, quick actions.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import {
  getPrimaryWallet, getTransactions, getTokenMetrics,
  getNetworkStats, getStakingPools,
} from '../services/api';
import type { WalletRow, TransactionRow, TokenMetricsRow } from '../services/api';
import { loadWallet } from '../services/wallet';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'MainTabs'> };

export default function DashboardScreen({ navigation }: Props): React.JSX.Element {
  const { wallet, setWallet, tokenMetrics, setTokenMetrics,
    networkStats, setNetworkStats, balance, usdValue, userId } = useAppStore();

  const [recentTxs, setRecentTxs] = useState<TransactionRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const storedWallet = await loadWallet();
      const userId = storedWallet?.address || '';

      const [metrics, stats, txs] = await Promise.all([
        getTokenMetrics().catch(() => null),
        getNetworkStats().catch(() => null),
        getTransactions(storedWallet?.address || '', 5).catch(() => []),
      ]);

      if (metrics) setTokenMetrics(metrics);
      if (stats) setNetworkStats(stats);
      setRecentTxs(txs);

      // Try to get wallet from backend
      try {
        const dbWallet = await getPrimaryWallet(userId);
        if (dbWallet) setWallet(dbWallet);
      } catch {
        // Offline mode - use stored wallet
        if (storedWallet && !wallet) {
          setWallet({
            id: 'local', address: storedWallet.address,
            balance: 0, staked_balance: 0, user_id: '',
            label: storedWallet.label, is_primary: 1,
            created_at: storedWallet.createdAt, updated_at: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.error('Dashboard fetch error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setWallet, setTokenMetrics, setNetworkStats]);

  useEffect(() => { fetchData(); }, []);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const formatBalance = (num: number) => num.toLocaleString(undefined, {
    minimumFractionDigits: 4, maximumFractionDigits: 4,
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>HSMC Wallet</Text>
          <Text style={styles.headerSubtitle}>
            Block {networkStats?.block_height?.toLocaleString() || '—'}
            {' · '}
            {networkStats?.tps?.toFixed(1) || '0'} TPS
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C5CE7" />}
      >
        {loading ? (
          <ActivityIndicator size="large" color="#6C5CE7" style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Balance Card */}
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Total Balance</Text>
              <Text style={styles.balanceAmount}>
                {formatBalance(balance)} HSMC
              </Text>
              <Text style={styles.balanceUsd}>
                ≈ ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
              </Text>
              {tokenMetrics && (
                <View style={styles.priceRow}>
                  <Text style={styles.priceText}>
                    HSMC: ${tokenMetrics.price.toFixed(4)}
                  </Text>
                  <Text style={[
                    styles.priceChange,
                    { color: tokenMetrics.price_change_24h >= 0 ? '#00C853' : '#FF5252' },
                  ]}>
                    {tokenMetrics.price_change_24h >= 0 ? '+' : ''}
                    {tokenMetrics.price_change_24h.toFixed(2)}%
                  </Text>
                </View>
              )}
            </View>

            {/* Staked Balance (if any) */}
            {wallet && wallet.staked_balance > 0 && (
              <View style={styles.stakedCard}>
                <Text style={styles.stakedLabel}>Staked</Text>
                <Text style={styles.stakedAmount}>
                  {formatBalance(wallet.staked_balance)} HSMC
                </Text>
              </View>
            )}

            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Send')}
              >
                <Text style={styles.actionIcon}>↑</Text>
                <Text style={styles.actionLabel}>Send</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Receive')}
              >
                <Text style={styles.actionIcon}>↓</Text>
                <Text style={styles.actionLabel}>Receive</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Staking')}
              >
                <Text style={styles.actionIcon}>📈</Text>
                <Text style={styles.actionLabel}>Stake</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Privacy')}
              >
                <Text style={styles.actionIcon}>🔒</Text>
                <Text style={styles.actionLabel}>Privacy</Text>
              </TouchableOpacity>
            </View>

            {/* Recent Transactions */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Transactions</Text>
              <TouchableOpacity onPress={() => navigation.navigate('TransactionHistory')}>
                <Text style={styles.seeAllText}>See All</Text>
              </TouchableOpacity>
            </View>

            {recentTxs.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>📭</Text>
                <Text style={styles.emptyText}>No transactions yet</Text>
              </View>
            ) : (
              recentTxs.map((tx) => {
                const isSent = wallet && tx.from_address.toLowerCase() === wallet.address.toLowerCase();
                return (
                  <TouchableOpacity
                    key={tx.id}
                    style={styles.txRow}
                    onPress={() => navigation.navigate('TransactionDetail', { txId: tx.id })}
                  >
                    <View style={[styles.txIconContainer, { backgroundColor: isSent ? '#FF525220' : '#00C85320' }]}>
                      <Text style={{ color: isSent ? '#FF5252' : '#00C853', fontSize: 18 }}>
                        {isSent ? '↑' : '↓'}
                      </Text>
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txAddress} numberOfLines={1}>
                        {isSent ? 'To: ' : 'From: '}
                        {(isSent ? tx.to_address : tx.from_address).slice(0, 10)}...
                      </Text>
                      <Text style={styles.txDate}>
                        {new Date(tx.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={styles.txAmount}>
                      <Text style={[styles.txAmountText, { color: isSent ? '#FF5252' : '#00C853' }]}>
                        {isSent ? '-' : '+'}{tx.amount.toFixed(4)}
                      </Text>
                      <Text style={styles.txStatus}>{tx.status}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            {/* Network Status */}
            {networkStats && (
              <View style={styles.networkCard}>
                <Text style={styles.networkTitle}>Network Status</Text>
                <View style={styles.networkRow}>
                  <Text style={styles.networkLabel}>Nodes</Text>
                  <Text style={styles.networkValue}>{networkStats.active_nodes}</Text>
                </View>
                <View style={styles.networkRow}>
                  <Text style={styles.networkLabel}>Hash Rate</Text>
                  <Text style={styles.networkValue}>{networkStats.hash_rate}</Text>
                </View>
                <View style={styles.networkRow}>
                  <Text style={styles.networkLabel}>Difficulty</Text>
                  <Text style={styles.networkValue}>{networkStats.network_difficulty.toLocaleString()}</Text>
                </View>
                <View style={styles.networkRow}>
                  <Text style={styles.networkLabel}>TPS</Text>
                  <Text style={styles.networkValue}>{networkStats.tps.toFixed(1)}</Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  headerSubtitle: { color: '#666677', fontSize: 12, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 16 },
  settingsIcon: { fontSize: 22 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 100 },
  balanceCard: {
    backgroundColor: '#151520', borderRadius: 16, padding: 24,
    alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#2A2A35',
  },
  balanceLabel: { color: '#888899', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  balanceAmount: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', fontFamily: 'monospace' },
  balanceUsd: { color: '#888899', fontSize: 14, marginTop: 4 },
  priceRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  priceText: { color: '#AAAAAA', fontSize: 12 },
  priceChange: { fontSize: 12, fontWeight: '600' },
  stakedCard: {
    backgroundColor: '#1A1540', borderRadius: 12, padding: 16,
    marginTop: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2A2060',
  },
  stakedLabel: { color: '#6C5CE7', fontSize: 12, textTransform: 'uppercase' },
  stakedAmount: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginTop: 4 },
  quickActions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 24, marginBottom: 24 },
  actionButton: { alignItems: 'center', padding: 12 },
  actionIcon: { fontSize: 28, marginBottom: 4 },
  actionLabel: { color: '#888899', fontSize: 12, fontWeight: '600' },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  seeAllText: { color: '#6C5CE7', fontSize: 13 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: { color: '#555566', fontSize: 14 },
  txRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#151520',
    borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#2A2A35',
  },
  txIconContainer: {
    width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center',
  },
  txInfo: { flex: 1, marginLeft: 12 },
  txAddress: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  txDate: { color: '#555566', fontSize: 11, marginTop: 2 },
  txAmount: { alignItems: 'flex-end' },
  txAmountText: { fontSize: 14, fontWeight: '600', fontFamily: 'monospace' },
  txStatus: { color: '#555566', fontSize: 10, marginTop: 2, textTransform: 'capitalize' },
  networkCard: {
    backgroundColor: '#151520', borderRadius: 12, padding: 16,
    marginTop: 16, borderWidth: 1, borderColor: '#2A2A35',
  },
  networkTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  networkRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  networkLabel: { color: '#666677', fontSize: 13 },
  networkValue: { color: '#AAAAAA', fontSize: 13, fontFamily: 'monospace' },
});
