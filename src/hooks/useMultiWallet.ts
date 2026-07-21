import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from './useAuth';
import { toast } from '@/hooks/use-toast';
import { generateMnemonic, deriveAddress, encryptMnemonic } from '@/utils/bip39-wallet';

export interface WalletRecord {
  id: string;
  address: string;
  balance: number;
  staked_balance: number;
  user_id: string;
  label: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export const useMultiWallet = () => {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWallets = useCallback(async () => {
    if (!user) { setWallets([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (!error && data) {
      const w = data as WalletRecord[];
      setWallets(w);
      // Restore active wallet from localStorage or use primary
      const stored = localStorage.getItem(`hsmc_active_wallet_${user.id}`);
      const found = w.find(x => x.id === stored) || w.find(x => x.is_primary) || w[0];
      if (found) setActiveWalletId(found.id);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchWallets();

    if (!user) return;
    const channel = supabase
      .channel('multi-wallet-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` }, () => {
        fetchWallets();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchWallets]);

  const activeWallet = wallets.find(w => w.id === activeWalletId) || wallets[0] || null;

  const switchWallet = (walletId: string) => {
    setActiveWalletId(walletId);
    if (user) localStorage.setItem(`hsmc_active_wallet_${user.id}`, walletId);
  };

  const createWallet = async (label: string, password?: string): Promise<WalletRecord | null> => {
    if (!user) return null;
    try {
      // Generate new BIP39 wallet
      const mnemonic = generateMnemonic();
      const address = await deriveAddress(mnemonic);

      const { data, error } = await supabase.from('wallets').insert({
        user_id: user.id,
        address,
        balance: 0,
        staked_balance: 0,
        label: label || `Wallet ${wallets.length + 1}`,
        is_primary: false,
      }).select().single();

      if (error) throw error;

      // Encrypt and store seed for this wallet
      if (password) {
        const encrypted = await encryptMnemonic(mnemonic, password);
        localStorage.setItem(`hsmc_encrypted_seed_${user.id}_${address}`, encrypted);
      }

      toast({ title: '✅ Wallet created', description: `${label}: ${address.slice(0, 16)}...` });
      return data as WalletRecord;
    } catch (err) {
      toast({ title: 'Failed to create wallet', description: String(err), variant: 'destructive' });
      return null;
    }
  };

  const setPrimary = async (walletId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('wallets')
      .update({ is_primary: true })
      .eq('id', walletId)
      .eq('user_id', user.id);
    if (!error) {
      toast({ title: 'Primary wallet updated' });
      fetchWallets();
    }
  };

  const internalTransfer = async (fromId: string, toId: string, amount: number, note?: string): Promise<boolean> => {
    if (!user) return false;
    const from = wallets.find(w => w.id === fromId);
    const to = wallets.find(w => w.id === toId);
    if (!from || !to) { toast({ title: 'Wallet not found', variant: 'destructive' }); return false; }
    if (amount <= 0 || amount > from.balance) {
      toast({ title: 'Invalid amount', description: `Available: ${from.balance.toFixed(4)} HSMC`, variant: 'destructive' });
      return false;
    }

    try {
      // H7 FIX: Use atomic API endpoint instead of two separate UPDATE calls
      // This prevents fund loss if the first UPDATE succeeds and the second fails.
      const API_BASE = 'http://localhost:3001';
      const res = await fetch(`${API_BASE}/api/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromWalletId: fromId,
          toWalletId: toId,
          amount,
          userId: user.id,
          note: note || null,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Transfer failed');
      }

      toast({ title: '✅ Transfer complete', description: `${amount.toFixed(4)} HSMC → ${to.label} (zero fee, atomic)` });

      // Refresh wallets to get updated balances
      await fetchWallets();
      return true;
    } catch (err) {
      toast({ title: 'Transfer failed', description: String(err), variant: 'destructive' });
      // Refetch in case the API updated balances but the response was lost
      await fetchWallets();
      return false;
    }
  };

  return { wallets, activeWallet, activeWalletId, loading, switchWallet, createWallet, setPrimary, internalTransfer, refetch: fetchWallets };
};
