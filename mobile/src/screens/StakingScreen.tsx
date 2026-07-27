/**
 * StakingScreen — Stake HSMC, view active stakes, rewards, and unstake.
 * Connects to the real staking API endpoints.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import {
  getStakingPools, getUserStakes, stakeTokens, unstakeTokens,
} from '../services/api';
import type { StakingPoolRow, StakeRow } from '../services/api';
import { notifyStakingReward } from '../services/notifications';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Staking'> };

export default function StakingScreen({ navigation }: Props): React.JSX.Element {
  const { wallet, userId } = useAppStore();
  const [pools, setPools] = useState<StakingPoolRow[]>([]);
  const [stakes, setStakes] = useState<StakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [poolData, stakeData] = await Promise.all([
        getStakingPools().catch(() => []),
        getUserStakes(userId || '').catch(() => []),
      ]);
      setPools(poolData);
      setStakes(stakeData);
    } catch (error) {
      console.error('Staking fetch error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { fetchData(); }, []);

  const handleStake = async () => {
    const amount = parseFloat(stakeAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid stake amount.');
      return;
    }
    if (!selectedPool) {
      Alert.alert('Select Pool', 'Please select a staking pool.');
      return;
    }
    if (!wallet) {
      Alert.alert('No Wallet', 'No wallet found.');
      return;
    }
    if (amount > wallet.balance) {
      Alert.alert('Insufficient Balance', `You have ${wallet.balance.toFixed(4)} HSMC available.`);
      return;
    }

    setActionLoading(true);
    try {
      await stakeTokens(userId || '', selectedPool, amount, wallet.id);
      Alert.alert('Staked!', `${amount.toFixed(4)} HSMC staked successfully.`);
      setStakeAmount('');
      setSelectedPool(null);
      fetchData();
    } catch (error) {
      Alert.alert('Error', 'Failed to stake. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnstake = async (stake: StakeRow) => {
    if (!wallet) return;
    if (stake.status !== 'active') {
      Alert.alert('Already Unstaked', 'This stake has already been unstaked.');
      return;
    }

    Alert.alert(
      'Unstake',
      `Unstake ${stake.amount.toFixed(4)} HSMC${stake.rewards_earned > stake.rewards_claimed ? ` + ${(stake.rewards_earned - stake.rewards_claimed).toFixed(4)} rewards` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unstake',
          onPress: async () => {
            setActionLoading(true);
            try {
              await unstakeTokens(
                stake.id, stake.amount,
                stake.rewards_earned, stake.rewards_claimed,
                wallet.id
              );
              Alert.alert('Unstaked', 'Funds returned to your wallet.');
              fetchData();
            } catch (error) {
              Alert.alert('Error', 'Failed to unstake.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const totalStaked = stakes.filter(s => s.status === 'active').reduce((sum, s) => sum + s.amount, 0);
  const totalRewards = stakes.filter(s => s.status === 'active')
    .reduce((sum, s) => sum + (s.rewards_earned - s.rewards_claimed), 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Staking</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor="#6C5CE7" />}
      >
        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Staked</Text>
            <Text style={styles.summaryValue}>{totalStaked.toFixed(4)} HSMC</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Rewards</Text>
            <Text style={[styles.summaryValue, { color: '#00C853' }]}>
              {totalRewards.toFixed(4)} HSMC
            </Text>
          </View>
        </View>

        {/* Stake form */}
        <Text style={styles.sectionTitle}>Stake HSMC</Text>
        <TextInput
          style={styles.input}
          value={stakeAmount}
          onChangeText={setStakeAmount}
          placeholder="Amount to stake"
          placeholderTextColor="#555566"
          keyboardType="decimal-pad"
        />

        <Text style={styles.poolLabel}>Select Pool</Text>
        {pools.map(pool => (
          <TouchableOpacity
            key={pool.id}
            style={[styles.poolCard, selectedPool === pool.id && styles.poolCardSelected]}
            onPress={() => setSelectedPool(pool.id)}
          >
            <View style={styles.poolInfo}>
              <Text style={styles.poolName}>{pool.name}</Text>
              <Text style={styles.poolDetail}>APR: {pool.apr}% · Min: {pool.min_stake} HSMC</Text>
            </View>
            <View style={styles.poolStats}>
              <Text style={styles.poolTvl}>{pool.total_staked.toLocaleString()} HSMC</Text>
              <Text style={styles.poolCommission}>{(pool.commission_rate * 100).toFixed(1)}% fee</Text>
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.stakeButton, actionLoading && styles.buttonDisabled]}
          onPress={handleStake}
          disabled={actionLoading || !selectedPool || !stakeAmount}
        >
          {actionLoading ? <ActivityIndicator color="#FFFFFF" /> :
            <Text style={styles.stakeButtonText}>Stake Now</Text>}
        </TouchableOpacity>

        {/* Active stakes */}
        <Text style={styles.sectionTitle}>Your Stakes</Text>
        {stakes.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No active stakes</Text>
          </View>
        ) : (
          stakes.map(stake => (
            <View key={stake.id} style={styles.stakeCard}>
              <View style={styles.stakeInfo}>
                <Text style={styles.stakePool}>{stake.pool?.name || 'Unknown Pool'}</Text>
                <Text style={styles.stakeAmount}>{stake.amount.toFixed(4)} HSMC</Text>
                <Text style={styles.stakeReward}>
                  Rewards: {(stake.rewards_earned - stake.rewards_claimed).toFixed(4)} HSMC
                </Text>
                <Text style={[styles.stakeStatus, stake.status === 'active' ? { color: '#00C853' } : { color: '#888' }]}>
                  {stake.status}
                </Text>
              </View>
              {stake.status === 'active' && (
                <TouchableOpacity
                  style={styles.unstakeButton}
                  onPress={() => handleUnstake(stake)}
                >
                  <Text style={styles.unstakeText}>Unstake</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E2E' },
  backButton: { color: '#6C5CE7', fontSize: 16 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 80 },
  summaryCard: { flexDirection: 'row', backgroundColor: '#151520', borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#2A2A35' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: '#2A2A35' },
  summaryLabel: { color: '#888899', fontSize: 12, textTransform: 'uppercase', marginBottom: 4 },
  summaryValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginTop: 24, marginBottom: 12 },
  input: { backgroundColor: '#151520', borderRadius: 12, padding: 14, color: '#FFFFFF', fontSize: 16, borderWidth: 1, borderColor: '#2A2A35', marginBottom: 12 },
  poolLabel: { color: '#888899', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginBottom: 8 },
  poolCard: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#151520',
    borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 2, borderColor: '#2A2A35',
  },
  poolCardSelected: { borderColor: '#6C5CE7', backgroundColor: '#1A1540' },
  poolInfo: { flex: 1 },
  poolName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  poolDetail: { color: '#666677', fontSize: 12, marginTop: 2 },
  poolStats: { alignItems: 'flex-end' },
  poolTvl: { color: '#AAAAAA', fontSize: 13, fontFamily: 'monospace' },
  poolCommission: { color: '#666677', fontSize: 11, marginTop: 2 },
  stakeButton: { backgroundColor: '#6C5CE7', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.5 },
  stakeButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { color: '#555566', fontSize: 14 },
  stakeCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#151520', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#2A2A35',
  },
  stakeInfo: { flex: 1 },
  stakePool: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  stakeAmount: { color: '#AAAAAA', fontSize: 13, fontFamily: 'monospace', marginTop: 2 },
  stakeReward: { color: '#00C853', fontSize: 12, marginTop: 2 },
  stakeStatus: { fontSize: 11, textTransform: 'capitalize', marginTop: 2 },
  unstakeButton: { backgroundColor: '#FF525220', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  unstakeText: { color: '#FF5252', fontSize: 13, fontWeight: '600' },
});
