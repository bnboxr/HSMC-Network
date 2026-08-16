/**
 * HSMC Mobile Wallet — Global State (Zustand)
 */

import { create } from 'zustand';
import type { WalletRow, TokenMetricsRow, NetworkStatsRow } from '../services/api';

interface AuthState {
  isLoggedIn: boolean;
  token: string | null;
  userId: string | null;
}

interface WalletState {
  wallet: WalletRow | null;
  wallets: WalletRow[];
  balance: number;
  usdValue: number;
  tokenMetrics: TokenMetricsRow | null;
  networkStats: NetworkStatsRow | null;
  isOnline: boolean;
  isSyncing: boolean;
}

interface AppStore extends AuthState, WalletState {
  // Auth actions
  login: (token: string, userId: string) => void;
  logout: () => void;
  restoreAuth: (token: string, userId: string) => void;

  // Wallet actions
  setWallet: (wallet: WalletRow | null) => void;
  setWallets: (wallets: WalletRow[]) => void;
  updateBalance: (balance: number, stakedBalance: number) => void;
  setTokenMetrics: (metrics: TokenMetricsRow | null) => void;
  setNetworkStats: (stats: NetworkStatsRow | null) => void;

  // Network actions
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;

  // Computed
  getUsdValue: () => number;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Auth state
  isLoggedIn: false,
  token: null,
  userId: null,

  // Wallet state
  wallet: null,
  wallets: [],
  balance: 0,
  usdValue: 0,
  tokenMetrics: null,
  networkStats: null,
  isOnline: true,
  isSyncing: false,

  // Auth actions
  login: (token: string, userId: string) =>
    set({ isLoggedIn: true, token, userId }),

  logout: () =>
    set({
      isLoggedIn: false,
      token: null,
      userId: null,
      wallet: null,
      wallets: [],
      balance: 0,
      usdValue: 0,
    }),

  restoreAuth: (token: string, userId: string) =>
    set({ isLoggedIn: true, token, userId }),

  // Wallet actions
  setWallet: (wallet) =>
    set({
      wallet,
      balance: wallet?.balance || 0,
      usdValue: (wallet?.balance || 0) * (get().tokenMetrics?.price || 0),
    }),

  setWallets: (wallets) => set({ wallets }),

  updateBalance: (balance, stakedBalance) => {
    const state = get();
    set({
      balance,
      usdValue: balance * (state.tokenMetrics?.price || 0),
    });
    if (state.wallet) {
      set({
        wallet: { ...state.wallet, balance, staked_balance: stakedBalance },
      });
    }
  },

  setTokenMetrics: (metrics) => {
    const state = get();
    set({
      tokenMetrics: metrics,
      usdValue: state.balance * (metrics?.price || 0),
    });
  },

  setNetworkStats: (stats) => set({ networkStats: stats }),

  // Network actions
  setOnline: (online) => set({ isOnline: online }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),

  // Computed
  getUsdValue: () => {
    const state = get();
    return state.balance * (state.tokenMetrics?.price || 0);
  },
}));
