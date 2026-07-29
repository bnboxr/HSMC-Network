/**
 * Public Landing/Marketing Page — /landing
 * Accessible without authentication. CTA leads to /onboarding.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield, Zap, Globe, Database, Code, Lock, Cpu, Network,
  ArrowRight, Activity, Users, Clock, Layers, ChevronDown,
  FileCode, Server
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import NetworkVisualization from '@/components/NetworkVisualization';
import { formatNumber, formatLargeNumber } from '@/utils/blockchain-generator';
import { SEO } from '@/components/SEO';

// ─── Features ─────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: Shield, title: 'Ring Signature Privacy', desc: 'Monero-style ring signatures obfuscate transaction origins across ring sizes of 7–16 decoys.', color: 'hsl(var(--primary))' },
  { icon: Zap, title: '~60 Second Block Time', desc: 'Privacy-preserving PoW mining with hybrid consensus mechanism targeting ~60 second block times.', color: 'hsl(var(--secondary))' },
  { icon: Globe, title: 'Multi-Chain Bridge', desc: '10 cross-chain connectors via wHSMC wrapped tokens: BSC, ETH, Polygon, Arbitrum, Optimism, Base, Avalanche, Fantom, Gnosis, and Celo.', color: 'hsl(var(--accent))' },
  { icon: Database, title: 'Sharding-Ready Architecture', desc: 'Sharding framework available in hsmc-rollup crate — ready for deployment when network demand requires horizontal scaling.', color: 'hsl(var(--primary))' },
  { icon: Code, title: 'EVM Compatible', desc: 'Deploy Ethereum smart contracts seamlessly with full Solidity and Rust WASM support.', color: 'hsl(var(--secondary))' },
  { icon: Lock, title: 'AES-256 Wallet Security', desc: 'BIP39 25-word seed phrase with AES-256-GCM encryption. Industry-standard wallet security with no custodial risk.', color: 'hsl(var(--accent))' },
];

const TECH = [
  { icon: Cpu, label: 'Hybrid PoW + PoS' },
  { icon: Network, label: 'P2P libp2p' },
  { icon: FileCode, label: 'WASM VM' },
  { icon: Server, label: 'Edge Nodes' },
];

export const LandingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<{ tps: number; active_nodes: number; total_transactions: number; latency: number } | null>(null);
  const [tokenPrice, setTokenPrice] = useState<number | null>(null);


  // Redirect logged-in users with wallets straight to /app
  useEffect(() => {
    if (!user) return;
    supabase.from('wallets').select('id').eq('user_id', user.id).limit(1).maybeSingle().then(({ data }) => {
      if (data) navigate('/app', { replace: true });
    });
  }, [user, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: ns }, { data: tm }] = await Promise.all([
        supabase.from('network_stats').select('tps,active_nodes,total_transactions,latency').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('token_metrics').select('price').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (ns) setStats(ns as any);
      if (tm) setTokenPrice(tm.price);
    };
    fetchData();

    const ch = supabase.channel('landing-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_stats' }, p => { if (p.new) setStats(p.new as any); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'token_metrics' }, p => { if (p.new) setTokenPrice((p.new as any).price); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="HSMC — Privacy-First Blockchain Network"
        description="Privacy-first blockchain with Ring Signatures, RingCT and BIP39 wallets. Stake HSMC and bridge across 10+ networks."
        path="/landing"
      />


      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4 border-b border-border/30 backdrop-blur-xl bg-background/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/30">
            <Activity className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold gradient-text">HSMC</span>
        </div>
        <div className="flex items-center gap-3">
          {tokenPrice !== null && tokenPrice > 0 && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-muted-foreground px-3 py-1.5 rounded-full bg-muted/30 border border-border/40">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
              HSMC ${tokenPrice.toFixed(6)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate('/onboarding')}>Sign In</Button>
          <Button size="sm" className="gap-1.5" onClick={() => navigate('/onboarding')}>
            Launch App <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
        <NetworkVisualization />
        <div className="absolute inset-0 hex-grid-bg opacity-30 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/30 to-background pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'var(--gradient-hero)' }} />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full opacity-20 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, hsl(var(--primary)), transparent 60%)' }} />

        <div className="container mx-auto px-4 relative z-10 py-16 text-center">
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>

            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full glass border-primary/20 mb-8"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
              </span>
              <span className="section-eyebrow">Network Online — Block Engine Active</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-5xl sm:text-7xl lg:text-8xl font-black mb-6 leading-[0.9] tracking-tight"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              <span className="gradient-text">HSMC</span>
              <span className="text-foreground">-HSMC</span>
              <br />
              <span className="text-2xl sm:text-3xl md:text-4xl font-medium text-muted-foreground tracking-normal">
                Privacy-First Blockchain Network
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="text-base sm:text-lg text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed"
            >
              Ring Signatures · Stealth Addresses · RingCT · Multi-Chain Bridge · HSMC Native Token
            </motion.p>

            {/* Feature pills */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
              className="flex flex-wrap justify-center gap-3 mb-10">
              {[
                { icon: Shield, text: 'RingCT Privacy' },
                { icon: Zap, text: '~60s Blocks' },
                { icon: Globe, text: '10 Chains' },
                { icon: Lock, text: 'AES-256 Wallet' },
                { icon: Cpu, text: 'Hybrid PoW+PoS' },
              ].map(f => (
                <div key={f.text} className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-muted/40 border border-border text-sm">
                  <f.icon className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium text-muted-foreground">{f.text}</span>
                </div>
              ))}
            </motion.div>

            {/* CTAs */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
              <Button size="lg" className="group gap-2 font-semibold px-8" onClick={() => navigate('/onboarding')}>
                Launch App
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button variant="outline" size="lg" className="font-semibold px-8"
                onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
                Learn More
              </Button>
            </motion.div>

            {/* Live stats */}
            <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
              className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
              {stats ? (
                [
                  { label: 'TPS', value: formatNumber(stats.tps), unit: 'tx/s' },
                  { label: 'Active Nodes', value: formatNumber(stats.active_nodes), unit: 'nodes' },
                  { label: 'Total Tx', value: formatLargeNumber(stats.total_transactions), unit: 'confirmed' },
                  { label: 'Latency', value: `${stats.latency}`, unit: 'ms avg' },
                ].map((stat, i) => (
                  <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 + i * 0.08 }}
                    className="glass-panel text-center py-4">
                    <div className="text-2xl sm:text-3xl font-black neon-text mb-0.5">{stat.value}</div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{stat.unit}</div>
                    <div className="text-xs text-muted-foreground/60 mt-0.5">{stat.label}</div>
                  </motion.div>
                ))
              ) : (
                [
                  { label: 'TPS', value: '—', unit: 'tx/s' },
                  { label: 'Active Nodes', value: '—', unit: 'nodes' },
                  { label: 'Total Tx', value: '—', unit: 'confirmed' },
                  { label: 'Latency', value: '—', unit: 'ms avg' },
                ].map(stat => (
                  <div key={stat.label} className="glass-panel text-center py-4">
                    <div className="text-2xl font-black text-muted-foreground/30 mb-0.5">—</div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{stat.unit}</div>
                    <div className="text-xs text-muted-foreground/60 mt-0.5">{stat.label}</div>
                  </div>
                ))
              )}
            </motion.div>
          </motion.div>

          {/* Scroll cue */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}
            className="mt-16 flex justify-center">
            <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex flex-col items-center gap-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              <span className="text-xs font-mono">Scroll to explore</span>
              <ChevronDown className="w-4 h-4 animate-bounce" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-24">
        <div className="container mx-auto px-4">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <p className="section-eyebrow mb-4">Technology</p>
            <h2 className="text-3xl sm:text-5xl font-black mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
              Built for <span className="gradient-text">Privacy & Scale</span>
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">
              Every component designed from first principles. No compromises.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.07 }} className="glass-card p-6 group hover:scale-[1.02] transition-transform">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                  style={{ background: `${f.color}18`, color: f.color }}>
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold mb-2 text-sm">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Tech stack row */}
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            className="flex flex-wrap justify-center gap-3 mt-10">
            {TECH.map(t => (
              <div key={t.label} className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted/30 border border-border/50 text-sm">
                <t.icon className="w-4 h-4 text-primary" />
                <span className="font-mono text-muted-foreground">{t.label}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Tokenomics Preview ─────────────────────────────────────────────── */}
      <section className="py-24 gradient-mesh">
        <div className="container mx-auto px-4">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
            <p className="section-eyebrow mb-4">Token</p>
            <h2 className="text-3xl sm:text-5xl font-black mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
              HSMC <span className="gradient-text">Tokenomics</span>
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-sm">
              Fixed supply, real-demand driven. No pre-mine inflation. No team unlock dumping.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto mb-10">
            {[
              { label: 'Total Supply', value: '100M HSMC', sublabel: 'Hard capped' },
              { label: 'Block Reward', value: '2.5 HSMC', sublabel: 'Per block' },
              { label: 'Staking APR', value: '12%+', sublabel: 'Variable' },
              { label: 'Tx Privacy', value: 'RingCT', sublabel: 'Default on' },
            ].map((item, i) => (
              <motion.div key={item.label} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                className="glass-panel text-center py-5">
                <div className="text-2xl font-black gradient-text mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
                  {item.value}
                </div>
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{item.label}</div>
                <div className="text-[10px] text-muted-foreground/50 mt-0.5">{item.sublabel}</div>
              </motion.div>
            ))}
          </div>

          {tokenPrice !== null && tokenPrice > 0 && (
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              className="max-w-sm mx-auto glass-panel text-center py-5">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Live Price</p>
              <p className="text-3xl font-black gradient-text">${tokenPrice.toFixed(6)}</p>
              <p className="text-xs text-muted-foreground mt-1">HSMC / USD</p>
            </motion.div>
          )}
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-2xl shadow-primary/30">
              <Activity className="w-8 h-8 text-primary-foreground" />
            </div>
            <h2 className="text-3xl sm:text-5xl font-black mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
              Ready to join the <span className="gradient-text">network?</span>
            </h2>
            <p className="text-muted-foreground mb-8 text-sm sm:text-base">
              Create your wallet in 2 minutes. No KYC. Maximum privacy.
            </p>
            <Button size="lg" className="group gap-2 font-semibold px-10 py-5 text-base" onClick={() => navigate('/onboarding')}>
              Create Free Account
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/30 py-8">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold gradient-text">HSMC</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">Privacy-First Blockchain · Open Source</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <button onClick={() => navigate('/onboarding')} className="hover:text-foreground transition-colors">App</button>
            <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-foreground transition-colors">Features</button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
