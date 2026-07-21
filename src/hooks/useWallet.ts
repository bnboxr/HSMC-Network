import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from "./useAuth";
import { withRetry } from "@/utils/db-retry";

interface Wallet {
  id: string;
  address: string;
  balance: number;
  staked_balance: number;
  user_id: string;
  label: string;
  is_primary: boolean;
}

export const useWallet = () => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setWallet(null);
      setLoading(false);
      return;
    }

    const fetchWallet = async () => {
      // Try to get active wallet from localStorage preference, else primary wallet
      const activeId = localStorage.getItem(`hsmc_active_wallet_${user.id}`);
      
      const { data, error } = activeId
        ? await withRetry(() => supabase.from('wallets').select('*').eq('user_id', user.id).eq('id', activeId).maybeSingle())
        : await withRetry(() => supabase.from('wallets').select('*').eq('user_id', user.id).eq('is_primary', true).maybeSingle());

      if (error || !data) {
        const { data: fallback } = await withRetry(() => supabase
          .from("wallets")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle());
        setWallet(fallback as Wallet | null);
      } else {
        setWallet(data as Wallet);
      }
      setLoading(false);
    };

    fetchWallet();

    // Also re-fetch on manual trigger from HSMCPay
    const handleRefresh = () => fetchWallet();
    window.addEventListener('hsmc-wallet-refresh', handleRefresh);

    // Subscribe to wallet changes for active wallet
    const channel = supabase
      .channel('wallet-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallets',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new) {
            const activeId = localStorage.getItem(`hsmc_active_wallet_${user.id}`);
            const updated = payload.new as Wallet;
            // Only update state if this event is for the currently displayed wallet
            setWallet(prev => {
              if (!prev) return updated;
              if (activeId && updated.id === activeId) return updated;
              if (!activeId && (updated.is_primary || updated.id === prev.id)) return updated;
              return prev; // ignore updates for other wallets
            });
          }
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('hsmc-wallet-refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [user]);

  return { wallet, loading };
};
