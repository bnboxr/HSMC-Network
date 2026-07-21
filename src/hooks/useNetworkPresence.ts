/**
 * useNetworkPresence
 * - Registers the current user as a real network peer on mount
 * - Updates last_seen_at every 30s (heartbeat)
 * - Uses sessionStorage flag so active_nodes is only incremented ONCE per tab session
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from './useAuth';

function getRegion(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (!tz) return 'Unknown';
    const continent = tz.split('/')[0];
    const map: Record<string, string> = {
      Europe: 'Europe', America: 'Americas', Asia: 'Asia',
      Africa: 'Africa', Australia: 'Oceania', Pacific: 'Oceania',
      Atlantic: 'Americas', Indian: 'Asia', Arctic: 'Europe', Antarctica: 'Other',
    };
    return map[continent] ?? 'Unknown';
  } catch {
    return 'Unknown';
  }
}

const SESSION_KEY = 'network_presence_registered';

export const useNetworkPresence = () => {
  const { user } = useAuth();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupDoneRef = useRef(false);

  useEffect(() => {
    if (!user) return;

    const peerId = `peer-${user.id.slice(0, 8)}`;
    const region = getRegion();
    const alreadyRegistered = sessionStorage.getItem(SESSION_KEY) === peerId;

    const measureLatency = async (): Promise<number> => {
      const t0 = performance.now();
      await supabase.from('network_stats').select('id').limit(1);
      return Math.round(performance.now() - t0);
    };

    const register = async () => {
      const latency = await measureLatency();

      // Upsert peer record
      await supabase.rpc('upsert_user_peer', {
        p_peer_id: peerId,
        p_ip_address: '0.0.0.0',
        p_region: region,
        p_latency: latency,
      });

      // Only increment active_nodes once per tab session
      if (!alreadyRegistered) {
        await supabase.rpc('increment_active_nodes', { delta: 1 });
        sessionStorage.setItem(SESSION_KEY, peerId);
      }
    };

    register();

    // Heartbeat every 30s — just refreshes last_seen_at, no node count change
    heartbeatRef.current = setInterval(async () => {
      const latency = await measureLatency();
      await supabase.rpc('upsert_user_peer', {
        p_peer_id: peerId,
        p_ip_address: '0.0.0.0',
        p_region: region,
        p_latency: latency,
      });
    }, 30_000);

    const handleUnload = () => {
      if (!cleanupDoneRef.current && sessionStorage.getItem(SESSION_KEY) === peerId) {
        supabase.rpc('increment_active_nodes', { delta: -1 });
        supabase.from('network_peers').update({ status: 'disconnected' }).eq('peer_id', peerId);
        sessionStorage.removeItem(SESSION_KEY);
        cleanupDoneRef.current = true;
      }
    };

    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [user]);
};
