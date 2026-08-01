import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Wifi, WifiOff, Globe, Loader2, Activity } from 'lucide-react';
import { useBlockchain } from '@/hooks/useBlockchain';
import { supabase } from '@/integrations/db/client';

interface Peer {
  id: string;
  peer_id: string;
  ip_address: string;
  port: number;
  status: string;
  latency: number;
  version: string;
  region: string;
  last_seen_at: string;
}

function lastSeen(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ago`;
}

export const NetworkSection = () => {
  const { networkStats } = useBlockchain();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPeers = async () => {
      const { data, error } = await supabase
        .from('network_peers')
        .select('*')
        .order('latency', { ascending: true });
      if (!error && data) setPeers(data as Peer[]);
      setLoading(false);
    };

    fetchPeers();

    const channel = supabase
      .channel('network-peers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_peers' }, () => {
        fetchPeers();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const connectedPeers = peers.filter((p) => p.status === 'connected');
  const syncingPeers = peers.filter((p) => p.status === 'syncing');
  const regions = new Set(peers.map((p) => p.region));

  return (
    <section id="network" className="py-20">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="section-eyebrow mb-4">P2P Network</p>
          <h2 className="text-3xl sm:text-4xl font-black mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
            Network <span className="gradient-text">Peers</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Real-time view of connected peer nodes across the HSMC network
          </p>
        </motion.div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 max-w-3xl mx-auto">
          {[
            { label: 'Connected', value: connectedPeers.length, icon: Wifi, color: 'text-secondary', bg: 'hsl(var(--secondary) / 0.1)' },
            { label: 'Syncing', value: syncingPeers.length, icon: Activity, color: 'text-primary', bg: 'hsl(var(--primary) / 0.1)' },
            { label: 'Total Peers', value: peers.length, icon: Users, color: 'text-foreground', bg: 'hsl(var(--muted))' },
            { label: 'Regions', value: regions.size, icon: Globe, color: 'text-accent', bg: 'hsl(var(--accent) / 0.1)' },
          ].map(({ label, value, icon: Icon, color, bg }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07 }}
              className="glass-card p-4 text-center"
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="p-1.5 rounded-md" style={{ background: bg }}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
              </div>
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </motion.div>
          ))}
        </div>

        {/* Network TPS & consensus from live DB */}
        {networkStats && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto mb-8 glass-card p-4 flex flex-wrap items-center justify-around gap-4 text-center"
          >
            {[
              { label: 'Consensus', value: networkStats.consensus_state },
              { label: 'TPS', value: networkStats.tps },
              { label: 'Block Height', value: networkStats.block_height.toLocaleString() },
              { label: 'Hash Rate', value: networkStats.hash_rate },
              { label: 'Avg Latency', value: `${networkStats.latency}ms` },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-lg font-bold font-mono neon-text">{value}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
              </div>
            ))}
          </motion.div>
        )}

        {/* Peers Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : peers.length === 0 ? (
          <div className="glass-panel text-center py-16 text-muted-foreground">
            <WifiOff className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No peers connected to the network yet.</p>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-panel overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {peers.map((peer, index) => (
                <motion.div
                  key={peer.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.04 }}
                  className="glass-card p-4 hover:border-primary/30 transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          peer.status === 'connected'
                            ? 'bg-secondary'
                            : peer.status === 'syncing'
                            ? 'bg-primary animate-pulse'
                            : 'bg-muted-foreground'
                        }`}
                      />
                      <span className="font-mono text-sm truncate max-w-[140px]">{peer.peer_id}</span>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 ${
                        peer.status === 'connected'
                          ? 'status-stable'
                          : peer.status === 'syncing'
                          ? 'status-syncing'
                          : 'bg-muted text-muted-foreground border-border'
                      }`}
                    >
                      {peer.status}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Address</span>
                      <span className="font-mono">{peer.ip_address}:{peer.port}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Latency</span>
                      <span
                        className={
                          peer.latency < 50
                            ? 'text-secondary'
                            : peer.latency < 100
                            ? 'text-yellow-400'
                            : 'text-destructive'
                        }
                      >
                        {peer.latency}ms
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Region</span>
                      <span className="text-muted-foreground">{peer.region}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-mono text-muted-foreground">{peer.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Seen</span>
                      <span className="text-muted-foreground">{lastSeen(peer.last_seen_at)}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Global Distribution Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-8 glass-panel text-center"
        >
          <h3 className="text-lg font-semibold mb-2">Global Network Distribution</h3>
          {peers.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              {Array.from(regions).map((region) => {
                const count = peers.filter((p) => p.region === region).length;
                return (
                  <div key={region} className="px-3 py-1.5 rounded-full bg-muted/30 border border-border text-xs font-mono">
                    <span className="text-primary">{region}</span>
                    <span className="text-muted-foreground ml-1.5">×{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-20">
              <Globe className="w-12 h-12 text-primary/10" />
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-4">
            {peers.length > 0
              ? `${peers.length} peer nodes across ${regions.size} regions`
              : 'No peers connected yet'}
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default NetworkSection;
