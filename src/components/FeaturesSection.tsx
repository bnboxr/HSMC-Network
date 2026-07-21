import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Zap, Globe, Database, Code, Lock, Cpu, Network, FileCode, Server, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/db/client';

const features = [
  {
    icon: Shield,
    title: 'Ring Signature Privacy',
    description: 'Monero-style ring signatures obfuscate transaction origins across configurable ring sizes of 7–16 decoys.',
    accent: 'hsl(var(--primary))',
  },
  {
    icon: Zap,
    title: 'Sub-second Finality',
    description: 'High throughput with Proof-of-Stake consensus ensuring confirmed blocks within 2 seconds average.',
    accent: 'hsl(var(--secondary))',
  },
  {
    icon: Globe,
    title: '100+ Chain Multichain',
    description: 'Native HSMC token interoperable with wHSMC, HSMC-EUR, HSMC-USD, HSMC-LEU, HSMC-XAU and more.',
    accent: 'hsl(var(--accent))',
  },
  {
    icon: Database,
    title: 'Sharded Architecture',
    description: 'Horizontal scaling through sharding — performance scales linearly with network growth.',
    accent: 'hsl(var(--primary))',
  },
  {
    icon: Code,
    title: 'EVM Compatible',
    description: 'Deploy Ethereum smart contracts seamlessly with full Solidity and Rust WASM support.',
    accent: 'hsl(var(--secondary))',
  },
  {
    icon: Lock,
    title: 'AES-256 Wallet Security',
    description: 'BIP39 25-word seed phrase with AES-256-GCM encryption and WebAuthn biometric unlock.',
    accent: 'hsl(var(--accent))',
  },
];

const techStack = [
  { icon: Cpu, label: 'PoS Consensus' },
  { icon: Network, label: 'P2P libp2p' },
  { icon: FileCode, label: 'WASM VM' },
  { icon: Server, label: 'Edge Nodes' },
];

interface PlatformStats {
  uptime_percent: number;
  countries_count: number;
  tvl: number;
  developers_count: number;
}

const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
const fmtHSMC = (n: number) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M HSMC`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K HSMC`;
  return `${n.toFixed(2)} HSMC`;
};

export const FeaturesSection = () => {
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    supabase.from('platform_stats').select('*').limit(1).maybeSingle()
      .then(({ data }) => { if (data) setPlatformStats(data as PlatformStats); });

    const ch = supabase.channel('platform-stats-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_stats' }, (p) => {
        if (p.new) setPlatformStats(p.new as PlatformStats);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Show stats only when there is real data (non-zero)
  const hasRealData = platformStats && (
    platformStats.developers_count > 0 ||
    platformStats.tvl > 0 ||
    platformStats.countries_count > 0 ||
    platformStats.uptime_percent > 0
  );

  const statsData = hasRealData ? [
    { value: fmtPct(platformStats!.uptime_percent), label: 'Block Uptime', sub: 'last 24h' },
    { value: fmtCount(platformStats!.countries_count), label: 'Peer Regions', sub: 'active nodes' },
    { value: fmtHSMC(platformStats!.tvl), label: 'Staked TVL', sub: 'real on-chain' },
    { value: fmtCount(platformStats!.developers_count), label: 'Wallet Users', sub: 'registered' },
  ] : null;

  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 gradient-mesh opacity-60 pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <p className="section-eyebrow mb-4">Core Technology</p>
          <h2 className="text-3xl sm:text-4xl font-black mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
            Why <span className="gradient-text">HSMC</span>?
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Enterprise-grade cryptography meets consumer-grade UX — production ready, no shortcuts.
          </p>
        </motion.div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-16">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.07 }}
              className="glass-card p-6 group hover:border-primary/25 transition-all duration-200 relative overflow-hidden"
            >
              {/* Accent line */}
              <div className="absolute top-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                style={{ background: `linear-gradient(90deg, ${feature.accent}, transparent)` }} />

              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-lg transition-colors duration-200"
                  style={{ background: `${feature.accent}18`, color: feature.accent }}>
                  <feature.icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold mb-1.5 text-sm">{feature.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tech Stack */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-6">Powered By</p>
          <div className="flex flex-wrap justify-center gap-3">
            {techStack.map((tech, index) => (
              <motion.div
                key={tech.label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.07 }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full glass border-primary/15 hover:border-primary/35 transition-colors"
              >
                <tech.icon className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">{tech.label}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Stats Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-panel relative overflow-hidden"
        >
          <div className="absolute inset-0 hex-grid-bg opacity-20 pointer-events-none" />
          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {platformStats === null ? (
              <div className="col-span-4 flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : statsData ? (
              statsData.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.08 }}
                >
                  <div className="text-2xl sm:text-3xl font-black gradient-text mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
                    {stat.value}
                  </div>
                  <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{stat.label}</div>
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">{stat.sub}</div>
                </motion.div>
              ))
            ) : (
              <div className="col-span-4 text-center py-4">
                <p className="text-sm text-muted-foreground font-mono">Network stats will appear once activity begins</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default FeaturesSection;
