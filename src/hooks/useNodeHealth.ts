/**
 * useNodeHealth — polls the node-proxy /health endpoint every 15s
 * Returns: status ('online' | 'offline' | 'checking'), latency in ms
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/db/client';

export type NodeStatus = 'online' | 'offline' | 'checking';

export interface NodeHealth {
  status: NodeStatus;
  latencyMs: number | null;
  blockHeight: number | null;
  version: string | null;
  lastChecked: Date | null;
}

const POLL_INTERVAL = 15_000; // 15 seconds

export function useNodeHealth() {
  const [health, setHealth] = useState<NodeHealth>({
    status: 'checking',
    latencyMs: null,
    blockHeight: null,
    version: null,
    lastChecked: null,
  });

  const check = useCallback(async () => {
    const start = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke('node-proxy', {
        body: { path: '/health', method: 'GET' },
      });

      const latencyMs = Math.round(performance.now() - start);

      // node-proxy returns { ok, node_online, data } — check nested data
      const nodeData = data?.data ?? data;
      const isOnline = data?.node_online === true && data?.ok === true;

      if (error || !isOnline) {
        setHealth(prev => ({
          ...prev,
          status: 'offline',
          latencyMs: null,
          lastChecked: new Date(),
        }));
        return;
      }

      setHealth({
        status: 'online',
        latencyMs,
        blockHeight: nodeData?.block_height ?? nodeData?.height ?? null,
        version: nodeData?.version ?? null,
        lastChecked: new Date(),
      });
    } catch {
      // Silently handle — node is simply offline
      setHealth(prev => ({
        ...prev,
        status: 'offline',
        latencyMs: null,
        lastChecked: new Date(),
      }));
    }
  }, []);

  useEffect(() => {
    check();
    const timer = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [check]);

  return { health, refresh: check };
}
