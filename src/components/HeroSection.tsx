import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Shield, Zap, Globe, Loader2, Lock, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NetworkVisualization from './NetworkVisualization';
import { supabase } from '@/integrations/db/client';
import { formatNumber, formatLargeNumber } from '@/utils/blockchain-generator';
import hsmcLogo from '@/assets/hsmc-logo.png';

export const HeroSection = () => {
  const [stats, setStats] = useState<{
    tps: number;
    active_nodes: number;
    total_transactions: number;
    latency: number;
  } | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      const { data } = await supabase
        .from('network_stats')
        .select('tps, active_nodes, total_transactions, latency')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setStats(data);
    };
    fetchStats();

    const channel = supabase
      .channel('hero-network-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_stats' }, (payload) => {
        if (payload.new) {
          const d = payload.new as any;
          setStats({ tps: d.tps, active_nodes: d.active_nodes, total_transactions: d.total_transactions, latency: d.latency });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden" style={{ background: 'hsl(var(--background))' }}>
      <NetworkVisualization />

      {/* Hex grid */}
      <div className="absolute inset-0 hex-grid-bg opacity-40 pointer-events-none" />

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/40 to-background pointer-events-none" />
      <div className="absolute inset-0" style={{ background: 'var(--gradient-hero)' }} />

      {/* Vertical light beam */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full opacity-20"
        style={{ background: 'linear-gradient(to bottom, hsl(var(--primary)), transparent 60%)' }} />

      <div className="container mx-auto px-4 relative z-10 pt-24 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-5xl mx-auto"
        >
          {/* Logo HSMC */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4"
          >
            <img
              src={hsmcLogo}
              alt="HSMC"
              className="h-24 sm:h-32 md:h-40 w-auto mx-auto object-contain select-none
                drop-shadow-[0_0_24px_rgba(59,130,246,0.5)]
                hover:drop-shadow-[0_0_40px_rgba(59,130,246,0.8)]
                transition-all duration-500"
              draggable={false}
            />
          </motion.div>

          {/* Eyebrow */}
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

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7 }}
            className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black mb-6 leading-[0.9] tracking-tight"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            <span className="gradient-text">HSMC</span>
            <span className="text-foreground">-HSMC</span>
            <br />
            <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-medium text-muted-foreground tracking-normal">
              Privacy-First Blockchain Network
            </span>
          </motion.h1>

          {/* Sub */}
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.6 }}
            className="text-base sm:text-lg text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed"
          >
            Ring Signatures · Stealth Addresses · RingCT · 100+ Chain Multichain · HSMC Native Token
          </motion.p>

          {/* Feature pills */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.5 }}
            className="flex flex-wrap justify-center gap-3 mb-10"
          >
            {[
              { icon: Shield, text: 'RingCT Privacy' },
              { icon: Zap, text: 'Sub-second Finality' },
              { icon: Globe, text: '100+ Chains' },
              { icon: Lock, text: 'AES-256 Wallet' },
              { icon: Cpu, text: 'PoS Consensus' },
            ].map((f) => (
              <div key={f.text} className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-muted/40 border border-border text-sm">
                <f.icon className="w-3.5 h-3.5 text-primary" />
                <span className="font-medium text-muted-foreground">{f.text}</span>
              </div>
            ))}
          </motion.div>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20"
          >
            <a href="/onboarding">
              <Button
                size="lg"
                className="group gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold px-8"
              >
                Launch App
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </a>
            <Button
              variant="outline"
              size="lg"
              className="font-semibold px-8 border-border/60 hover:border-primary/40"
              onClick={() => document.getElementById('docs')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Documentation
            </Button>
          </motion.div>

          {/* Live stats */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.7 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto"
          >
            {stats ? (
              [
                { label: 'TPS', value: `${formatNumber(stats.tps)}`, unit: 'tx/s' },
                { label: 'Active Nodes', value: formatNumber(stats.active_nodes), unit: 'nodes' },
                { label: 'Total Tx', value: formatLargeNumber(stats.total_transactions), unit: 'confirmed' },
                { label: 'Latency', value: `${stats.latency}`, unit: 'ms avg' },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.9 + i * 0.08 }}
                  className="glass-panel text-center py-4"
                >
                  <div className="text-2xl sm:text-3xl font-black neon-text mb-0.5">{stat.value}</div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{stat.unit}</div>
                  <div className="text-xs text-muted-foreground/60 mt-0.5">{stat.label}</div>
                </motion.div>
              ))
            ) : (
              <div className="col-span-4 flex justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            )}
          </motion.div>
        </motion.div>
      </div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="w-5 h-9 rounded-full border border-muted-foreground/25 flex items-start justify-center p-1.5">
          <motion.div
            animate={{ y: [0, 7, 0] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="w-1 h-1 rounded-full bg-primary"
          />
        </div>
      </motion.div>
    </section>
  );
};

export default HeroSection;
