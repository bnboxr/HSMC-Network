import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Eye,
  EyeOff,
  Lock,
  Key,
  Activity,
  Shuffle,
  CircleDot,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/integrations/db/client';
import { formatAddress } from '@/utils/blockchain-generator';

interface PrivacyTx {
  id: string;
  hash: string;
  amount: number;
  privacy_level: string;
  decoy_count: number;
  commitment: string;
  stealth_address: string;
  created_at: string;
  status: string;
}

const privacyTechStack = [
  {
    icon: Shuffle,
    name: 'Ring Signatures',
    tag: 'XMR-compatible',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    desc: 'Tranzacțiile sunt semnate de un grup de chei publice (ring size 11–16), imposibil de identificat semnătarul real. Identic cu Monero.',
    detail: 'Fiecare tranzacție include key images pentru a preveni double-spending, fără a dezvălui expeditorul.',
  },
  {
    icon: EyeOff,
    name: 'Stealth Addresses',
    tag: 'One-time addresses',
    color: 'text-secondary',
    bgColor: 'bg-secondary/10',
    desc: 'Destinatarul nu este niciodată expus pe blockchain. Se generează o adresă unică de unică folosință pentru fiecare tranzacție.',
    detail: 'Folosind protocolul ECDH, expeditorul creează o adresă stealth derivată din cheia publică a destinatarului.',
  },
  {
    icon: Lock,
    name: 'Confidential Transactions',
    tag: 'Pedersen Commitments',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-400/10',
    desc: 'Sumele tranzacțiilor sunt ascunse complet prin Pedersen Commitments + Bulletproofs. Nimeni nu poate vedea cât s-a trimis.',
    detail: 'RingCT (Ring Confidential Transactions) combină ring signatures cu commitments criptografice pentru privacy maxim.',
  },
  {
    icon: Activity,
    name: 'Bulletproofs',
    tag: 'Zero-knowledge',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    desc: 'Range proofs compacte care dovedesc că suma dintr-o tranzacție este pozitivă, fără a dezvălui valoarea exactă.',
    detail: 'Bulletproofs reduc dimensiunea range proofs de la ~10KB la ~700B, scăzând dramatic taxele de rețea.',
  },
  {
    icon: CircleDot,
    name: 'Dandelion++',
    tag: 'IP Obfuscation',
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    desc: 'Tranzacțiile sunt propagate în rețea prin noduri intermediare aleatoare înainte de broadcast, ascunzând IP-ul sursă.',
    detail: 'Faza "stem" propagă tranzacția printr-un lanț de noduri aleatorii. Faza "fluff" face broadcast normal, fără legătură cu sursa.',
  },
  {
    icon: Key,
    name: 'Dual-Key System',
    tag: 'Spend + View Keys',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-400/10',
    desc: 'Fiecare wallet are două chei separate: Spend Key (pentru tranzacții) și View Key (pentru audit opțional). Identic cu Monero.',
    detail: 'View Key permite unui auditor sau utilizatorului să vadă tranzacțiile primite, fără acces la fonduri.',
  },
];

const privacyLevelConfig: Record<string, { label: string; color: string; ringSize: string }> = {
  standard: { label: 'Standard', color: 'text-yellow-400', ringSize: '7' },
  private: { label: 'Private', color: 'text-primary', ringSize: '11' },
  maximum: { label: 'Maximum', color: 'text-secondary', ringSize: '16' },
};

export const PrivacySection = () => {
  const [privacyTxs, setPrivacyTxs] = useState<PrivacyTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTech, setExpandedTech] = useState<string | null>('Ring Signatures');
  const [stats, setStats] = useState({ total: 0, private: 0, maximum: 0 });

  useEffect(() => {
    const fetchPrivacyTxs = async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, hash, amount, privacy_level, decoy_count, commitment, stealth_address, created_at, status')
        .not('ring_signature', 'is', null)
        .order('created_at', { ascending: false })
        .limit(12);

      if (data) {
        setPrivacyTxs(data as PrivacyTx[]);
        setStats({
          total: data.length,
          private: data.filter(t => t.privacy_level === 'private').length,
          maximum: data.filter(t => t.privacy_level === 'maximum').length,
        });
      }
      setLoading(false);
    };

    fetchPrivacyTxs();

    const channel = supabase
      .channel('privacy-txs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, (payload) => {
        if (payload.new?.ring_signature) {
          setPrivacyTxs(prev => [payload.new as PrivacyTx, ...prev.slice(0, 11)]);
          setStats(prev => ({
            total: prev.total + 1,
            private: prev.private + (payload.new.privacy_level === 'private' ? 1 : 0),
            maximum: prev.maximum + (payload.new.privacy_level === 'maximum' ? 1 : 0),
          }));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <section id="privacy" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-medium">Monero-Level Privacy</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Privacy <span className="gradient-text">Architecture</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            HSMC implementează același model de privacy ca Monero (XMR) — zero tracking, zero surveillance, zero compromise.
          </p>
        </motion.div>

        {/* Privacy Stats */}
        <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto mb-12">
          {[
            { label: 'Private Txns', value: stats.private + stats.maximum, icon: Shield },
            { label: 'Max Privacy', value: stats.maximum, icon: Lock },
            { label: 'Ring Size', value: '11–16', icon: Shuffle },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="glass-card p-4 text-center"
            >
              <s.icon className="w-5 h-5 mx-auto mb-2 text-primary" />
              <div className="text-2xl font-bold neon-text">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Privacy Tech Stack */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="glass-panel"
          >
            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Privacy Protocol Stack
            </h3>
            <div className="space-y-3">
              {privacyTechStack.map((tech) => (
                <div key={tech.name} className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedTech(expandedTech === tech.name ? null : tech.name)}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${tech.bgColor}`}>
                        <tech.icon className={`w-4 h-4 ${tech.color}`} />
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-sm">{tech.name}</div>
                        <div className="text-xs text-muted-foreground">{tech.tag}</div>
                      </div>
                    </div>
                    {expandedTech === tech.name
                      ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                  <AnimatePresence>
                    {expandedTech === tech.name && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-border"
                      >
                        <div className="p-3 space-y-2">
                          <p className="text-sm text-muted-foreground">{tech.desc}</p>
                          <p className="text-xs text-muted-foreground/70 bg-muted/30 rounded p-2">{tech.detail}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Live Private Transactions */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="glass-panel"
          >
            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <Eye className="w-5 h-5 text-secondary" />
              Live Private Transactions
              <span className="ml-auto flex items-center gap-1 text-xs text-secondary">
                <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                Live
              </span>
            </h3>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : privacyTxs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Shield className="w-8 h-8 text-primary/50" />
                </div>
                <div>
                  <p className="font-semibold text-foreground mb-1">No transactions yet</p>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Tranzacțiile private vor apărea aici în timp real pe măsură ce utilizatorii trimit HSMC prin rețea.
                  </p>
                </div>
                <div className="text-xs text-muted-foreground/50 border border-border/20 rounded-lg px-3 py-1.5">
                  Fiecare tranzacție afișată este reală — Ring Signatures, Stealth Address, Commitment
                </div>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
                {privacyTxs.map((tx) => {
                    const lvl = privacyLevelConfig[tx.privacy_level] ?? privacyLevelConfig.standard;
                    return (
                      <motion.div
                        key={tx.id}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3 rounded-lg bg-muted/20 border border-border hover:border-primary/20 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-xs text-primary">{formatAddress(tx.hash, 8)}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border border-current ${lvl.color}`}>
                            {lvl.label} — Ring×{lvl.ringSize}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>
                            <span className="block text-muted-foreground/60">Stealth Addr</span>
                            <span className="font-mono">{tx.stealth_address?.slice(0, 14)}...</span>
                          </div>
                          <div>
                            <span className="block text-muted-foreground/60">Commitment</span>
                            <span className="font-mono">{tx.commitment?.slice(0, 14)}...</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <EyeOff className="w-3 h-3" /> Amount: <em>hidden</em>
                          </span>
                          <span className={`text-xs ${tx.status === 'confirmed' ? 'text-secondary' : 'text-yellow-400'}`}>
                            {tx.status}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
              </div>
            )}
          </motion.div>
        </div>

        {/* Comparison table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-8 glass-panel overflow-x-auto"
        >
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            HSMC vs. Alte Blockchain-uri — Privacy
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-muted-foreground">Feature</th>
                {['HSMC', 'Monero (XMR)', 'Zcash', 'Bitcoin', 'Ethereum'].map(chain => (
                  <th key={chain} className={`text-center py-2 px-3 ${chain === 'HSMC' ? 'text-primary' : 'text-muted-foreground'}`}>
                    {chain}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Ring Signatures', '✅', '✅', '❌', '❌', '❌'],
                ['Stealth Addresses', '✅', '✅', '⚠️', '❌', '❌'],
                ['Hidden Amounts', '✅', '✅', '✅', '❌', '❌'],
                ['IP Obfuscation', '✅', '✅', '❌', '❌', '❌'],
                ['Default Private', '✅', '✅', '❌', '❌', '❌'],
                ['Staking', '✅', '❌', '❌', '❌', '✅'],
                ['Smart Contracts', '❌', '❌', '✅', '❌', '✅'],
              ].map(([feature, ...vals]) => (
                <tr key={feature as string} className="border-b border-border/50 hover:bg-muted/10">
                  <td className="py-2 px-3 text-muted-foreground">{feature}</td>
                  {vals.map((v, i) => (
                    <td key={i} className="text-center py-2 px-3">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
};

export default PrivacySection;
