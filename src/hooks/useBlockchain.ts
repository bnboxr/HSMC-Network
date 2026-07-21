import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/db/client';

export interface DbTransaction {
  id: string;
  hash: string;
  from_address: string;
  to_address: string;
  amount: number;
  fee: number;
  status: string;
  block_number: number | null;
  confirmed_at: string | null;
  created_at: string;
  privacy_level: string | null;
  decoy_count: number | null;
  ring_signature: string | null;
  stealth_address: string | null;
  commitment: string | null;
  range_proof: string | null;
  key_image: string | null;
}

export interface DbBlock {
  id: string;
  block_number: number;
  hash: string;
  prev_hash: string;
  miner_address: string;
  nonce: number;
  difficulty: number;
  transactions_count: number;
  created_at: string;
  privacy_protocol: string | null;
}

export interface DbNetworkStats {
  id: string;
  tps: number;
  active_nodes: number;
  consensus_state: string;
  latency: number;
  total_transactions: number;
  block_height: number;
  hash_rate: string;
  network_difficulty: number;
  updated_at: string;
}

export const useBlockchain = () => {
  const [networkStats, setNetworkStats] = useState<DbNetworkStats | null>(null);
  const [transactions, setTransactions] = useState<DbTransaction[]>([]);
  const [blocks, setBlocks] = useState<DbBlock[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch network stats
  useEffect(() => {
    const fetchStats = async () => {
      const { data, error } = await supabase
        .from('network_stats')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setNetworkStats(data as DbNetworkStats);
      }
    };

    fetchStats();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('network-stats-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'network_stats' },
        (payload) => {
          if (payload.new) {
            setNetworkStats(payload.new as DbNetworkStats);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Fetch transactions
  useEffect(() => {
    const fetchTransactions = async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setTransactions(data as DbTransaction[]);
      }
      setLoading(false);
    };

    fetchTransactions();

    // Subscribe to new transactions
    const channel = supabase
      .channel('transactions-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        (payload) => {
          if (payload.new) {
            setTransactions((prev) => [payload.new as DbTransaction, ...prev.slice(0, 49)]);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Fetch blocks
  useEffect(() => {
    const fetchBlocks = async () => {
      const { data, error } = await supabase
        .from('blocks')
        .select('*')
        .order('block_number', { ascending: false })
        .limit(20);

      if (!error && data) {
        setBlocks(data as DbBlock[]);
      }
    };

    fetchBlocks();

    // Subscribe to new blocks
    const channel = supabase
      .channel('blocks-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'blocks' },
        (payload) => {
          if (payload.new) {
            setBlocks((prev) => [payload.new as DbBlock, ...prev.slice(0, 19)]);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Search by hash (blocks or transactions)
  const searchByHash = useCallback(
    async (query: string): Promise<{ type: 'block' | 'transaction' | null; data: DbBlock | DbTransaction | null }> => {
      // Search blocks
      const { data: blockData } = await supabase
        .from('blocks')
        .select('*')
        .ilike('hash', `%${query}%`)
        .limit(1)
        .maybeSingle();

      if (blockData) return { type: 'block', data: blockData as DbBlock };

      // Search transactions
      const { data: txData } = await supabase
        .from('transactions')
        .select('*')
        .ilike('hash', `%${query}%`)
        .limit(1)
        .maybeSingle();

      if (txData) return { type: 'transaction', data: txData as DbTransaction };

      return { type: null, data: null };
    },
    []
  );

  // Search by address
  const searchByAddress = useCallback(
    async (address: string): Promise<DbTransaction[]> => {
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .or(`from_address.ilike.%${address}%,to_address.ilike.%${address}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      return (data as DbTransaction[]) || [];
    },
    []
  );

  return {
    networkStats,
    transactions,
    blocks,
    loading,
    searchByHash,
    searchByAddress,
  };
};
