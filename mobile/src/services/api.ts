/**
 * HSMC Mobile Wallet — API Service
 * 
 * Communicates with the HSMC API server (port 3001) using Supabase-compatible
 * REST endpoints and privileged endpoints for auth, shielded, treasury, etc.
 */

const API_BASE_URL = __DEV__ 
  ? 'http://localhost:3001'
  : 'https://api.hsmc.network';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WalletRow {
  id: string;
  address: string;
  balance: number;
  staked_balance: number;
  user_id: string;
  label: string;
  is_primary: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  hash: string;
  from_address: string;
  to_address: string;
  amount: number;
  fee: number;
  status: string;
  privacy_level: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface StakingPoolRow {
  id: string;
  name: string;
  validator_address: string;
  apr: number;
  min_stake: number;
  commission_rate: number;
  total_staked: number;
  status: string;
}

export interface StakeRow {
  id: string;
  user_id: string;
  pool_id: string;
  amount: number;
  rewards_earned: number;
  rewards_claimed: number;
  staked_at: string;
  status: string;
  pool?: StakingPoolRow;
}

export interface TokenMetricsRow {
  id: string;
  price: number;
  price_change_24h: number;
  market_cap: number;
  volume_24h: number;
  circulating_supply: number;
  total_supply: number;
  staked_supply: number;
  token_holders: number;
  updated_at: string;
}

export interface NetworkStatsRow {
  id: string;
  active_nodes: number;
  block_height: number;
  consensus_state: string;
  hash_rate: string;
  latency: number;
  network_difficulty: number;
  total_transactions: number;
  tps: number;
  updated_at: string;
}

export interface ShieldedDepositRequest {
  amount: number;
  from_address: string;
  commitment?: string;
}

export interface ShieldedWithdrawRequest {
  amount: number;
  to_address: string;
  nullifier: string;
  proof: string;
}

export interface ShieldedStateResponse {
  pool_size: number;
  total_shielded: number;
  merkle_root: string;
  nullifiers_count: number;
}

// ─── Auth State ─────────────────────────────────────────────────────────────

let authToken: string | null = null;
let currentUserId: string | null = null;

export function setAuth(token: string, userId: string): void {
  authToken = token;
  currentUserId = userId;
}

export function clearAuth(): void {
  authToken = null;
  currentUserId = null;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'HSMC-Mobile/1.0',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage: string;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error || parsed.message || errorBody;
    } catch {
      errorMessage = errorBody || response.statusText;
    }
    throw new Error(`API Error ${response.status}: ${errorMessage}`);
  }

  return response.json();
}

// ─── REST API (Supabase-compatible) ─────────────────────────────────────────

/** Query rows from a table with filters */
export async function queryTable<T>(
  table: string,
  params: {
    select?: string;
    filters?: Record<string, string>;
    order?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<T[]> {
  const searchParams = new URLSearchParams();
  searchParams.set('select', params.select || '*');

  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      searchParams.set(key, `eq.${value}`);
    }
  }
  if (params.order) searchParams.set('order', params.order);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));

  return apiFetch<T[]>(`/rest/v1/${table}?${searchParams.toString()}`);
}

/** Insert rows into a table */
export async function insertIntoTable<T>(
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[]
): Promise<T> {
  return apiFetch<T>(`/rest/v1/${table}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** Update rows in a table */
export async function updateTable<T>(
  table: string,
  id: string,
  data: Record<string, unknown>
): Promise<T> {
  return apiFetch<T>(`/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** Delete rows from a table */
export async function deleteFromTable<T>(
  table: string,
  id: string
): Promise<T> {
  return apiFetch<T>(`/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
  });
}

// ─── Auth Endpoints ─────────────────────────────────────────────────────────

export async function apiRegister(
  email: string,
  password: string,
  walletAddress: string
): Promise<{ user_id: string; token: string }> {
  const result = await apiFetch<{ user_id: string; token: string; message?: string }>(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ email, password, wallet_address: walletAddress }),
    }
  );
  setAuth(result.token, result.user_id);
  return result;
}

export async function apiLogin(
  email: string,
  password: string
): Promise<{ user_id: string; token: string }> {
  const result = await apiFetch<{ user_id: string; token: string }>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }
  );
  setAuth(result.token, result.user_id);
  return result;
}

// ─── Wallet Endpoints ───────────────────────────────────────────────────────

export async function getWallets(userId: string): Promise<WalletRow[]> {
  return queryTable<WalletRow>('wallets', {
    filters: { user_id: userId },
    order: 'is_primary.desc',
  });
}

export async function getPrimaryWallet(userId: string): Promise<WalletRow | null> {
  const wallets = await queryTable<WalletRow>('wallets', {
    filters: { user_id: userId, is_primary: '1' },
    limit: 1,
  });
  return wallets[0] || null;
}

export async function createWallet(data: {
  user_id: string;
  address: string;
  label: string;
  is_primary?: boolean;
}): Promise<WalletRow> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const rows = await insertIntoTable<WalletRow[]>('wallets', {
    id,
    user_id: data.user_id,
    address: data.address,
    balance: 0,
    staked_balance: 0,
    label: data.label,
    is_primary: data.is_primary ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

// ─── Transaction Endpoints ──────────────────────────────────────────────────

export async function getTransactions(
  address: string,
  limit = 50
): Promise<TransactionRow[]> {
  // Search both from_address and to_address
  const [sent, received] = await Promise.all([
    queryTable<TransactionRow>('transactions', {
      filters: { from_address: address },
      order: 'created_at.desc',
      limit,
    }),
    queryTable<TransactionRow>('transactions', {
      filters: { to_address: address },
      order: 'created_at.desc',
      limit,
    }),
  ]);

  // Merge and deduplicate by id, sort by created_at desc
  const all = [...sent, ...received];
  const seen = new Set<string>();
  const merged: TransactionRow[] = [];
  for (const tx of all) {
    if (!seen.has(tx.id)) {
      seen.add(tx.id);
      merged.push(tx);
    }
  }
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return merged.slice(0, limit);
}

export async function sendTransaction(data: {
  from_address: string;
  to_address: string;
  amount: number;
  fee: number;
  privacy_level?: string;
}): Promise<TransactionRow> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const hash = `0x${Array.from(
    { length: 64 },
    () => Math.random().toString(16)[2]
  ).join('')}`;
  const now = new Date().toISOString();

  const rows = await insertIntoTable<TransactionRow[]>('transactions', {
    id,
    hash,
    from_address: data.from_address,
    to_address: data.to_address,
    amount: data.amount,
    fee: data.fee,
    status: 'pending',
    privacy_level: data.privacy_level || 'standard',
    created_at: now,
    confirmed_at: null,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

// ─── Staking Endpoints ──────────────────────────────────────────────────────

export async function getStakingPools(): Promise<StakingPoolRow[]> {
  return queryTable<StakingPoolRow>('staking_pools', {
    filters: { status: 'active' },
  });
}

export async function getUserStakes(userId: string): Promise<StakeRow[]> {
  const stakes = await queryTable<StakeRow>('stakes', {
    filters: { user_id: userId },
  });
  // Enrich with pool data
  const pools = await getStakingPools();
  const poolMap = new Map(pools.map(p => [p.id, p]));
  return stakes.map(s => ({ ...s, pool: poolMap.get(s.pool_id) }));
}

export async function stakeTokens(
  userId: string,
  poolId: string,
  amount: number,
  walletId: string
): Promise<StakeRow> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();

  const rows = await insertIntoTable<StakeRow[]>('stakes', {
    id,
    user_id: userId,
    pool_id: poolId,
    amount,
    rewards_earned: 0,
    rewards_claimed: 0,
    staked_at: now,
    status: 'active',
  });

  // Update wallet: deduct from balance, add to staked_balance
  const wallet = await queryTable<WalletRow>('wallets', {
    filters: { id: walletId },
    limit: 1,
  });
  if (wallet[0]) {
    await updateTable('wallets', walletId, {
      balance: wallet[0].balance - amount,
      staked_balance: wallet[0].staked_balance + amount,
      updated_at: now,
    });
  }

  return Array.isArray(rows) ? rows[0] : rows;
}

export async function unstakeTokens(
  stakeId: string,
  amount: number,
  rewardsEarned: number,
  rewardsClaimed: number,
  walletId: string
): Promise<void> {
  const now = new Date().toISOString();

  await updateTable('stakes', stakeId, {
    status: 'unstaked',
    unstake_at: now,
  });

  const wallet = await queryTable<WalletRow>('wallets', {
    filters: { id: walletId },
    limit: 1,
  });
  if (wallet[0]) {
    const pendingRewards = rewardsEarned - rewardsClaimed;
    await updateTable('wallets', walletId, {
      balance: wallet[0].balance + amount + pendingRewards,
      staked_balance: Math.max(0, wallet[0].staked_balance - amount),
      updated_at: now,
    });
  }
}

// ─── Shielded Pool Endpoints ────────────────────────────────────────────────

export async function shieldedDeposit(data: ShieldedDepositRequest): Promise<{ success: boolean; commitment: string }> {
  return apiFetch('/shielded/deposit', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function shieldedWithdraw(data: ShieldedWithdrawRequest): Promise<{ success: boolean; tx_hash: string }> {
  return apiFetch('/shielded/withdraw', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function shieldedState(): Promise<ShieldedStateResponse> {
  return apiFetch('/shielded/state');
}

export async function shieldedVerify(proof: string): Promise<{ valid: boolean }> {
  return apiFetch('/shielded/verify', {
    method: 'POST',
    body: JSON.stringify({ proof }),
  });
}

// ─── Treasury Endpoints ─────────────────────────────────────────────────────

export async function getTreasuryBalance(): Promise<{
  total_fees_collected: number;
  breakdown: Record<string, number>;
  transactions_count: number;
}> {
  return apiFetch('/treasury/balance');
}

// ─── Token Metrics Endpoints ────────────────────────────────────────────────

export async function getTokenMetrics(): Promise<TokenMetricsRow | null> {
  const metrics = await queryTable<TokenMetricsRow>('token_metrics', {
    order: 'updated_at.desc',
    limit: 1,
  });
  return metrics[0] || null;
}

// ─── Network Stats ──────────────────────────────────────────────────────────

export async function getNetworkStats(): Promise<NetworkStatsRow | null> {
  const stats = await queryTable<NetworkStatsRow>('network_stats', {
    order: 'updated_at.desc',
    limit: 1,
  });
  return stats[0] || null;
}

// ─── Health Check ───────────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string; tables: number }> {
  return apiFetch('/health');
}
