import { motion } from 'framer-motion';
import jsPDF from 'jspdf';
import {
  Download, Shield, Cpu, Globe, Layers, Lock, Coins, Users,
  ChevronRight, FileText, Scale, TrendingUp, Network, Zap,
  GitBranch, Key, Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/Navbar';
import hsmcLogo from '@/assets/hsmc-logo.png';
import { SEO } from '@/components/SEO';

// Aligned with real on-chain supply: 1,000,000,000,000 HSMC (1 trillion)
const TOKENOMICS = [
  { label: 'Mining Rewards', percent: 40, color: 'bg-primary', amount: '400,000,000,000' },
  { label: 'Ecosystem Fund', percent: 20, color: 'bg-secondary', amount: '200,000,000,000' },
  { label: 'Team & Advisors', percent: 15, color: 'bg-accent', amount: '150,000,000,000' },
  { label: 'Public Sale', percent: 15, color: 'bg-primary/60', amount: '150,000,000,000' },
  { label: 'Reserve', percent: 10, color: 'bg-muted-foreground/60', amount: '100,000,000,000' },
];

const ROADMAP = [
  {
    phase: 'Q1 2025', label: 'Foundation', done: true,
    items: ['Whitepaper v1.0', 'Core cryptographic primitives (ECDSA, Ring Signatures)', 'Testnet alpha', 'Web dApp launch'],
  },
  {
    phase: 'Q2 2025', label: 'Testnet', done: true,
    items: ['PoW mining testnet', 'HSMCPay Beta', 'BIP39 wallets', 'Privacy features: protocol-level, wallet activation pending'],
  },
  {
    phase: 'Q3 2025', label: 'Pre-Mainnet', done: false,
    items: ['Security audit (Ring Sig + RingCT)', 'Miner onboarding (10+ nodes)', 'Wrapped HSMC BEP-20', 'Exchange outreach'],
  },
  {
    phase: 'Q4 2025', label: 'Mainnet Launch', done: false,
    items: ['Genesis block', 'DEX liquidity pool', 'CEX listing (tier 2)', 'Mobile wallet app'],
  },
  {
    phase: '2026', label: 'Ecosystem Growth', done: false,
    items: ['Staking pools live', 'Cross-chain bridge', 'DAO governance live', 'Tier 1 CEX listing'],
  },
];

const SPECS = [
  { label: 'Consensus', value: 'SHA-256d Proof-of-Work', icon: Cpu },
  { label: 'Block Time', value: '~120 seconds', icon: Activity },
  { label: 'Total Supply', value: '1,000,000,000,000 HSMC', icon: Coins },
  { label: 'Block Reward', value: '50 HSMC (halving every 210,000 blocks)', icon: TrendingUp },
  { label: 'Privacy Protocol', value: 'RingCT v2 + Stealth Addresses + Bulletproofs', icon: Shield },
  { label: 'Ring Size', value: '11–16 (configurable)', icon: Key },
  { label: 'P2P Network', value: 'Dandelion++ (IP masking)', icon: Globe },
  { label: 'Algorithm', value: 'SHA-256d PoW + ECDSA P-256 signatures', icon: GitBranch },
  { label: 'Address Format', value: '0x + 20-byte ECDSA-derived', icon: Lock },
];

const PRIVACY = [
  {
    icon: Shield, title: 'Ring Signatures',
    tag: 'LSAG',
    desc: 'LSAG linkable ring signatures with ring size 11-16. Hides the true signer among decoys, preventing transaction graph analysis.',
    color: 'from-blue-500/20 to-blue-600/5',
    border: 'border-blue-500/30',
    glow: 'shadow-blue-500/20',
  },
  {
    icon: Lock, title: 'Stealth Addresses',
    tag: 'ECDH',
    desc: 'One-time addresses derived via ECDH. Each transaction uses a unique address — recipients cannot be linked on-chain.',
    color: 'from-purple-500/20 to-purple-600/5',
    border: 'border-purple-500/30',
    glow: 'shadow-purple-500/20',
  },
  {
    icon: Layers, title: 'RingCT',
    tag: 'Pedersen',
    desc: 'Ring Confidential Transactions hide transaction amounts using Pedersen commitments. Bulletproofs ensure range validity without revealing values.',
    color: 'from-cyan-500/20 to-cyan-600/5',
    border: 'border-cyan-500/30',
    glow: 'shadow-cyan-500/20',
  },
  {
    icon: Globe, title: 'Dandelion++',
    tag: 'P2P',
    desc: 'IP-masking P2P propagation protocol. Transaction origin is hidden through a "stem" phase before "fluff" broadcast.',
    color: 'from-green-500/20 to-green-600/5',
    border: 'border-green-500/30',
    glow: 'shadow-green-500/20',
  },
];

const USE_CASES = [
  { icon: Coins, title: 'Private Payments', desc: 'Send and receive HSMC with complete transaction privacy. Amounts, sender, and receiver are all hidden on-chain.' },
  { icon: TrendingUp, title: 'DeFi & Staking', desc: 'Stake HSMC for up to 18% APR. Participate in private liquidity pools and yield farming with zero knowledge.' },
  { icon: Users, title: 'Merchant Payments', desc: 'HSMCPay enables merchants to accept crypto payments with instant settlement and built-in 3D Secure verification.' },
];

export default function WhitepaperPage() {
  const handleDownload = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentW = pageW - margin * 2;
    let y = 20;

    const addLine = (text: string, size = 10, bold = false, color: [number, number, number] = [220, 220, 220]) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, contentW);
      lines.forEach((line: string) => {
        if (y > 270) { doc.addPage(); y = 20; doc.setFillColor(10, 5, 20); doc.rect(0, 0, pageW, 297, 'F'); }
        doc.text(line, margin, y);
        y += size * 0.45;
      });
      y += 2;
    };

    const addSection = (title: string) => {
      y += 4;
      doc.setFillColor(30, 20, 50);
      doc.rect(margin - 3, y - 5, contentW + 6, 9, 'F');
      addLine(title, 12, true, [150, 100, 255]);
      y += 2;
    };

    doc.setFillColor(10, 5, 20);
    doc.rect(0, 0, pageW, 297, 'F');
    doc.setFillColor(80, 40, 180);
    doc.rect(0, 0, pageW, 30, 'F');

    addLine('HSMC NETWORK', 22, true, [255, 255, 255]);
    addLine('WHITEPAPER v1.0 — March 2026', 11, false, [200, 180, 255]);
    addLine('hsmc.network  |  Chain ID: 7777', 9, false, [160, 140, 220]);
    y += 6;

    addSection('ABSTRACT');
    addLine('HSMC is a privacy-first Layer-1 blockchain combining Proof-of-Work consensus with Monero-inspired cryptographic privacy protocols. Every transaction is private by default through Ring Signatures, Stealth Addresses, and RingCT Confidential Transactions.', 9);

    addSection('TECHNICAL SPECIFICATIONS');
    [
      ['Consensus', 'SHA-256d Proof-of-Work'],
      ['Block Time', '~120 seconds'],
      ['Total Supply', '1,000,000,000,000 HSMC'],
      ['Block Reward', '50 HSMC (halving every 210,000 blocks)'],
      ['Privacy Protocol', 'RingCT v2 + Stealth Addresses + Bulletproofs'],
      ['Ring Size', '11–16 (configurable per transaction)'],
      ['P2P Network', 'Dandelion++ (IP masking)'],
      ['Algorithm', 'SHA-256d PoW + ECDSA P-256 signatures'],
      ['Chain ID', '7777'],
    ].forEach(([k, v]) => {
      addLine(`  ${k}: ${v}`, 9, false, [180, 220, 180]);
    });

    addSection('TOKEN ALLOCATION (1,000,000,000,000 HSMC — 1 TRILLION)');
    [
      ['Mining Rewards', '40%', '400,000,000,000 HSMC — distributed over ~200 years via halving'],
      ['Ecosystem Fund', '20%', '200,000,000,000 HSMC — grants, partnerships, developer bounties'],
      ['Team & Advisors', '15%', '150,000,000,000 HSMC — 2-year vesting, 6-month cliff'],
      ['Public Sale', '15%', '150,000,000,000 HSMC — ICO / DEX listing'],
      ['Reserve', '10%', '100,000,000,000 HSMC — emergency fund & CEX listings'],
    ].forEach(([cat, pct, desc]) => {
      addLine(`  ${pct}  ${cat}`, 9, true, [200, 160, 255]);
      addLine(`        ${desc}`, 8, false, [160, 160, 200]);
    });

    addSection('PRIVACY ARCHITECTURE');
    addLine('1. RING SIGNATURES (LSAG) — Each transaction is signed using a ring of 11-16 public keys, making it computationally infeasible to determine the actual signer.', 9);
    y += 2;
    addLine('2. STEALTH ADDRESSES — One-time destination addresses generated for each transaction. The recipient scans all UTXOs using their private view key.', 9);
    y += 2;
    addLine('3. RINGCT — Transaction amounts are hidden using Pedersen Commitments. Bulletproofs range proofs prove amounts are valid without revealing values.', 9);
    y += 2;
    addLine('4. DANDELION++ — Transaction propagation through a stem phase (single-hop forwarding) followed by a fluff phase (broadcast), masking the originating IP.', 9);

    addSection('RUST NODE ARCHITECTURE');
    addLine('The HSMC node is built in Rust with 7 crates:', 9);
    addLine('  hsmc-core    — Chain, Block, Transaction, Mempool structs', 9, false, [180, 220, 180]);
    addLine('  hsmc-crypto  — LSAG Ring Signatures, Stealth Addresses, RingCT, PoW miner', 9, false, [180, 220, 180]);
    addLine('  hsmc-p2p     — Peer registry, Dandelion++ gossip, sync service', 9, false, [180, 220, 180]);
    addLine('  hsmc-rpc     — Axum HTTP/JSON-RPC server (port 8080)', 9, false, [180, 220, 180]);
    addLine('  hsmc-stratum — WebSocket Stratum V1 mining pool (port 3333)', 9, false, [180, 220, 180]);
    addLine('  hsmc-storage — RocksDB persistence (blocks, transactions, mempool)', 9, false, [180, 220, 180]);
    addLine('  hsmc-node    — Main binary: wires all crates, starts all servers', 9, false, [180, 220, 180]);

    addSection('BRIDGE ARCHITECTURE (CROSS-CHAIN)');
    addLine('Wrapped HSMC (wHSMC) is available on BSC (BEP-20) and Ethereum (ERC-20) via a Lock & Mint bridge:', 9);
    addLine('  1. User locks HSMC on mainnet via bridge_lock() RPC call', 9);
    addLine('  2. Bridge relayer verifies lock transaction on-chain', 9);
    addLine('  3. wHSMC.mint(to, amount, mainnetTxHash) called on EVM chain', 9);
    addLine('  Bridge fee: 0.3% | Minimum bridge: 1 HSMC', 9);

    addSection('ROADMAP');
    [
      ['Q1-Q2 2025 ✅', 'Whitepaper, Core Cryptography, Testnet Alpha, Web dApp'],
      ['Q3 2025 ✅', 'PoW Mining Testnet, HSMCPay Beta, BIP39 Wallets'],
      ['Q3-Q4 2025 🔄', 'Security Audit, Miner Onboarding, Wrapped HSMC BEP-20'],
      ['Q4 2025', 'Genesis Block (Mainnet), DEX Liquidity Pool, Tier-2 CEX Listing'],
      ['Q1 2026', 'Mobile Wallet, Staking Pools, DAO Governance'],
      ['Q2-Q3 2026', 'Cross-chain Bridge Live, Tier-1 CEX Listing, Layer-2 Research'],
    ].forEach(([phase, items]) => {
      addLine(`  ${phase}`, 9, true, [255, 200, 100]);
      addLine(`    ${items}`, 8, false, [180, 180, 220]);
    });

    addSection('LEGAL DISCLAIMER');
    addLine('This document does not constitute an offer to sell or solicitation to purchase securities. HSMC tokens are utility tokens for network participation. Purchasers should consult legal counsel regarding applicable regulations in their jurisdiction.', 8, false, [150, 150, 150]);

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFillColor(10, 5, 20);
      doc.rect(0, 287, pageW, 10, 'F');
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 140);
      doc.text(`HSMC Whitepaper v1.0 — March 2026 — Page ${i}/${totalPages}`, margin, 293);
      doc.text('hsmc.network', pageW - margin, 293, { align: 'right' });
    }

    doc.save('HSMC-Whitepaper-v1.0.pdf');
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <SEO
        title="HSMC Whitepaper — Privacy Blockchain Technical Specification"
        description="HSMC whitepaper: Ring Signatures, RingCT, Stealth Addresses, tokenomics, roadmap and governance for a privacy-first blockchain."
        path="/whitepaper"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: "HSMC Whitepaper — Privacy Blockchain Technical Specification",
          description: "Technical whitepaper covering HSMC privacy protocols, tokenomics, roadmap and governance.",
          author: [
            { "@type": "Person", name: "Ifrim George" },
            { "@type": "Organization", name: "OXR.org" }
          ],
          publisher: { "@type": "Organization", name: "HSMC" },
          inLanguage: "en"
        }}
      />
      <Navbar />

      {/* Whitepaper sub-bar */}
      <div className="fixed top-16 left-0 right-0 z-40 glass py-2 px-6 flex items-center justify-between border-b border-border/40">
        <a href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group">
          <ChevronRight className="w-4 h-4 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
          Back to App
        </a>
        <div className="flex items-center gap-2">
          <a href="/mainnet">
            <Button variant="outline" size="sm" className="gap-2">
              <Network className="w-3.5 h-3.5" />
              Mainnet Hub
            </Button>
          </a>
          <Button variant="hero" size="sm" onClick={handleDownload} className="gap-2">
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </Button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════ HERO */}
      <section className="relative min-h-[70vh] flex flex-col items-center justify-center overflow-hidden pt-20">
        {/* Background layers */}
        <div className="absolute inset-0 hex-grid-bg opacity-30 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/60 to-background pointer-events-none" />
        <div className="absolute inset-0" style={{ background: 'var(--gradient-hero)' }} />
        {/* Vertical beam */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full opacity-20"
          style={{ background: 'linear-gradient(to bottom, hsl(var(--primary)), transparent 70%)' }} />

        <div className="relative z-10 container mx-auto px-4 py-20 text-center">
          {/* HSMC Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="mb-8"
          >
            <img
              src={hsmcLogo}
              alt="HSMC"
              className="h-28 sm:h-36 md:h-44 w-auto mx-auto object-contain
                drop-shadow-[0_0_30px_rgba(59,130,246,0.6)]"
              draggable={false}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-mono mb-6">
              <FileText className="w-4 h-4" />
              Whitepaper v1.0 — March 2026
            </div>

            <h1 className="text-5xl sm:text-7xl font-black mb-4 leading-tight" style={{ fontFamily: 'var(--font-serif)' }}>
              <span className="gradient-text">HSMC</span>
              <br />
              <span className="text-foreground/90 text-3xl sm:text-4xl font-semibold">Privacy-First Blockchain</span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              A Layer-1 blockchain combining SHA-256 Proof-of-Work with Ring Signatures,
              Stealth Addresses, and RingCT for truly confidential transactions.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <Button variant="hero" size="lg" onClick={handleDownload} className="gap-2">
                <Download className="w-5 h-5" />
                Download Whitepaper
              </Button>
              <a href="/mainnet">
                <Button variant="outline" size="lg" className="gap-2">
                  <Network className="w-5 h-5" />
                  Launch Mainnet Hub
                </Button>
              </a>
            </div>
          </motion.div>
        </div>

        {/* Scroll cue */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
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

      {/* ══════════════════════════════════════════════════════ QUICK STATS BAR */}
      <section className="border-y border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[
              { label: 'Total Supply', value: '1T HSMC' },
              { label: 'Chain ID', value: '7777' },
              { label: 'Block Time', value: '~120s' },
              { label: 'Privacy', value: 'RingCT v2' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-xl sm:text-2xl font-black neon-text">{s.value}</div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="pb-32">
        {/* ══════════════════════════════════════════════════════ SPECS */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="text-center mb-12">
              <div className="section-eyebrow mb-3">Technical Overview</div>
              <h2 className="text-3xl sm:text-4xl font-bold">
                <span className="gradient-text">Technical</span> Specifications
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 max-w-6xl mx-auto">
              {SPECS.map(({ label, value, icon: Icon }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  viewport={{ once: true }}
                  className="glass-panel p-4 group hover:border-primary/30 transition-colors"
                >
                  <Icon className="w-5 h-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
                  <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">{label}</div>
                  <div className="text-xs font-semibold text-foreground leading-snug">{value}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ PRIVACY */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="text-center mb-12">
              <div className="section-eyebrow mb-3">Cryptographic Stack</div>
              <h2 className="text-3xl sm:text-4xl font-bold">
                <span className="gradient-text">Privacy</span> Protocol
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
              {PRIVACY.map(({ icon: Icon, title, tag, desc, color, border, glow }, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  viewport={{ once: true }}
                  className={`relative glass-panel p-6 border ${border} bg-gradient-to-br ${color} shadow-lg ${glow} hover:scale-[1.02] transition-transform`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl border ${border} flex items-center justify-center bg-background/50`}>
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-[9px] font-mono font-bold text-muted-foreground border border-border px-2 py-0.5 rounded-full">{tag}</span>
                  </div>
                  <h3 className="font-bold mb-2 text-foreground">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ RUST NODE */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="text-center mb-12">
              <div className="section-eyebrow mb-3">Node Architecture</div>
              <h2 className="text-3xl sm:text-4xl font-bold">
                <span className="gradient-text">Rust</span> Node — 7 Crates
              </h2>
            </div>
            <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { crate: 'hsmc-core', desc: 'Chain, Block, Transaction, Mempool in-memory state', color: 'border-blue-500/40 text-blue-400' },
                { crate: 'hsmc-crypto', desc: 'LSAG Ring Signatures, Stealth Addresses, RingCT, PoW miner', color: 'border-purple-500/40 text-purple-400' },
                { crate: 'hsmc-p2p', desc: 'Peer registry, Dandelion++ gossip, sync service', color: 'border-cyan-500/40 text-cyan-400' },
                { crate: 'hsmc-rpc', desc: 'Axum HTTP/JSON-RPC server on port 8080 + bridge endpoint', color: 'border-green-500/40 text-green-400' },
                { crate: 'hsmc-stratum', desc: 'WebSocket Stratum V1 mining pool server on port 3333', color: 'border-yellow-500/40 text-yellow-400' },
                { crate: 'hsmc-storage', desc: 'RocksDB persistence: blocks, transactions, mempool', color: 'border-orange-500/40 text-orange-400' },
                { crate: 'hsmc-node', desc: 'Main binary — wires all crates, restores chain from disk', color: 'border-red-500/40 text-red-400' },
              ].map(({ crate, desc, color }, i) => (
                <motion.div
                  key={crate}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  viewport={{ once: true }}
                  className={`glass-panel p-4 border ${color.split(' ')[0]}`}
                >
                  <div className={`text-sm font-mono font-bold mb-1 ${color.split(' ')[1]}`}>{crate}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </div>
            {/* cargo run snippet */}
            <div className="max-w-2xl mx-auto mt-8">
              <div className="glass-panel p-4 border border-primary/20 font-mono text-xs">
                <div className="text-muted-foreground mb-2 text-[10px] uppercase tracking-wider">Quick Start</div>
                <div className="text-green-400">$ git clone https://github.com/hsmc/node</div>
                <div className="text-green-400">$ cd rust-node</div>
                <div className="text-green-400">$ MINER_ADDRESS=0xYOUR_ADDRESS cargo run --release -p hsmc-node</div>
                <div className="text-muted-foreground mt-1"># RPC: http://localhost:8080  |  Stratum: ws://localhost:3333</div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ TOKENOMICS */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="text-center mb-12">
              <div className="section-eyebrow mb-3">Token Distribution</div>
              <h2 className="text-3xl sm:text-4xl font-bold">
                <span className="gradient-text">Tokenomics</span>
              </h2>
            </div>
            <div className="max-w-3xl mx-auto glass-panel p-8 border border-primary/20">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <div className="text-4xl font-black gradient-text">1,000,000,000,000</div>
                  <div className="text-muted-foreground text-sm mt-1">Total HSMC Supply (1 Trillion)</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-secondary">~200 Years</div>
                  <div className="text-muted-foreground text-sm mt-1">Mining Distribution</div>
                </div>
              </div>
              <div className="space-y-4">
                {TOKENOMICS.map(({ label, percent, color, amount }, i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    viewport={{ once: true }}
                  >
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-foreground font-medium">{label}</span>
                      <span className="text-muted-foreground font-mono text-xs">{percent}% — {amount} HSMC</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${percent}%` }}
                        transition={{ duration: 1.2, delay: 0.2 + i * 0.1, ease: 'easeOut' }}
                        viewport={{ once: true }}
                        className={`h-full rounded-full ${color}`}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="mt-6 p-4 bg-primary/5 border border-primary/20 rounded-xl text-xs text-muted-foreground">
                ⚡ Mining Rewards distributed over ~200 years via halving schedule (every 210,000 blocks ≈ 2 years). No inflation beyond max supply.
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ BRIDGE */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="text-center mb-12">
              <div className="section-eyebrow mb-3">Cross-Chain</div>
              <h2 className="text-3xl sm:text-4xl font-bold">
                <span className="gradient-text">Bridge</span> Architecture
              </h2>
            </div>
            <div className="max-w-4xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {[
                { chain: 'BSC', id: '56', token: 'BEP-20', borderCls: 'border-secondary/40', textCls: 'text-secondary' },
                { chain: 'Ethereum', id: '1', token: 'ERC-20', borderCls: 'border-primary/40', textCls: 'text-primary' },
              ].map(({ chain, id, token, borderCls, textCls }) => (
                <div key={chain} className={`glass-panel p-4 border ${borderCls} text-center`}>
                  <div className={`text-lg font-bold font-mono ${textCls}`}>wHSMC</div>
                    <div className="text-sm text-foreground font-semibold mt-1">{chain}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{token} · Chain {id}</div>
                  </div>
                ))}
              </div>
              <div className="glass-panel p-6 border border-primary/20">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center text-sm">
                  {[
                    { step: '01', label: 'Lock', desc: 'User calls bridge_lock() on HSMC mainnet RPC' },
                    { step: '02', label: 'Relay', desc: 'Bridge relayer verifies lock on-chain (2 block confirm)' },
                    { step: '03', label: 'Mint', desc: 'wHSMC.mint(to, amount, txHash) called on EVM chain' },
                  ].map(({ step, label, desc }) => (
                    <div key={step}>
                      <div className="text-2xl font-black gradient-text">{step}</div>
                      <div className="font-semibold text-foreground mt-1">{label}</div>
                      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-border/40 flex flex-wrap justify-center gap-6 text-xs text-muted-foreground">
                  <span>Bridge Fee: <strong className="text-foreground">0.3%</strong></span>
                  <span>Minimum: <strong className="text-foreground">1 HSMC</strong></span>
                  <span>Confirmation: <strong className="text-foreground">2 blocks</strong></span>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ ROADMAP */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="text-center mb-12">
              <div className="section-eyebrow mb-3">Development Timeline</div>
              <h2 className="text-3xl sm:text-4xl font-bold">
                <span className="gradient-text">Roadmap</span>
              </h2>
            </div>
            <div className="max-w-4xl mx-auto space-y-4">
              {ROADMAP.map(({ phase, label, done, items }, idx) => (
                <motion.div
                  key={phase}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  viewport={{ once: true }}
                  className={`glass-panel p-5 border-l-4 ${done ? 'border-l-secondary' : 'border-l-primary/40'}`}
                >
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <div className={`px-3 py-1 rounded-full text-xs font-mono font-bold ${done ? 'bg-secondary/20 text-secondary' : 'bg-primary/10 text-primary'}`}>
                      {phase}
                    </div>
                    <span className="font-bold">{label}</span>
                    {done && (
                      <span className="text-[10px] text-secondary bg-secondary/10 px-2 py-0.5 rounded-full border border-secondary/20">✓ Completed</span>
                    )}
                  </div>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {items.map(item => (
                      <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ChevronRight className={`w-3 h-3 flex-shrink-0 ${done ? 'text-secondary' : 'text-primary/50'}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ USE CASES */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="text-center mb-12">
              <div className="section-eyebrow mb-3">Applications</div>
              <h2 className="text-3xl sm:text-4xl font-bold">
                <span className="gradient-text">Use Cases</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {USE_CASES.map(({ icon: Icon, title, desc }, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  viewport={{ once: true }}
                  className="glass-panel p-6 hover:border-primary/30 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-bold text-lg mb-3">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ STAKING */}
        <section className="container mx-auto px-4 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="max-w-4xl mx-auto">
              <div className="glass-panel p-8 border border-secondary/20">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-secondary" />
                  </div>
                  <h2 className="text-2xl font-bold"><span className="text-secondary">Staking</span> & Consensus</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  {[
                    { label: 'Min Stake', value: '1,000 HSMC' },
                    { label: 'APR Range', value: '6–18%' },
                    { label: 'Lock Period', value: '30–365 days' },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center p-3 bg-secondary/5 border border-secondary/10 rounded-xl">
                      <div className="text-xl font-black text-secondary">{value}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Staking pools offer 6–18% APR depending on pool size and lock period. Commission rate: 2–10%.</p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ DISCLAIMER */}
        <section className="container mx-auto px-4 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="max-w-3xl mx-auto glass-panel p-8 border border-amber-500/20 bg-amber-500/5">
              <div className="flex items-center gap-3 mb-4">
                <Scale className="w-6 h-6 text-amber-500 flex-shrink-0" />
                <h3 className="font-bold text-lg text-amber-500">Legal Disclaimer</h3>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>This whitepaper is for informational purposes only and does not constitute an offer to sell, or a solicitation of an offer to buy, any securities or financial instruments.</p>
                <p>HSMC tokens are <strong className="text-foreground">utility tokens</strong> designed for participation in the HSMC network. They are not investment products.</p>
                <p>Participation in the HSMC network may be subject to regulatory requirements depending on your jurisdiction. Users are responsible for ensuring compliance with applicable local laws.</p>
                <p>The development roadmap is subject to change. Nothing in this document constitutes a guarantee of future performance or outcomes.</p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ PRIVACY POLICY */}
        <section id="privacy" className="container mx-auto px-4 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="max-w-3xl mx-auto glass-panel p-8">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <Shield className="w-6 h-6 text-primary" />
                Privacy Policy
              </h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p><strong className="text-foreground">Last updated: March 2026</strong></p>
                <h3 className="text-base font-semibold text-foreground">1. Data We Collect</h3>
                <p>HSMC collects minimal data necessary to operate the platform: email address for authentication, wallet addresses generated on-chain, and transaction hashes stored on the public blockchain. We do not collect IP addresses, device fingerprints, or personal identification.</p>
                <h3 className="text-base font-semibold text-foreground">2. How We Use Your Data</h3>
                <p>Your email is used exclusively for authentication and critical security notifications. Wallet and transaction data is stored on the immutable blockchain and is public by design. We never sell or share personal data with third parties.</p>
                <h3 className="text-base font-semibold text-foreground">3. Privacy by Design</h3>
                <p>All wallet seed phrases are encrypted client-side using AES-256-GCM before any transmission. HSMC never has access to your unencrypted seed phrase. Ring Signatures and Stealth Addresses protect on-chain transaction privacy.</p>
                <h3 className="text-base font-semibold text-foreground">4. Data Retention</h3>
                <p>Account data is retained until account deletion. Blockchain data is permanent and cannot be deleted by design. You may request deletion of off-chain account data at any time by contacting contact@hsmc.io.</p>
                <h3 className="text-base font-semibold text-foreground">5. Contact</h3>
                <p>For privacy inquiries: <a href="mailto:contact@hsmc.io" className="text-primary hover:underline">contact@hsmc.io</a></p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ TERMS OF SERVICE */}
        <section id="terms" className="container mx-auto px-4 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="max-w-3xl mx-auto glass-panel p-8">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <Scale className="w-6 h-6 text-primary" />
                Terms of Service
              </h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p><strong className="text-foreground">Effective: March 2026</strong></p>
                <h3 className="text-base font-semibold text-foreground">1. Acceptance</h3>
                <p>By accessing or using HSMC, you agree to these terms. If you do not agree, do not use the platform.</p>
                <h3 className="text-base font-semibold text-foreground">2. Eligibility</h3>
                <p>You must be at least 18 years old and legally permitted to use cryptocurrency services in your jurisdiction. You are responsible for compliance with local laws.</p>
                <h3 className="text-base font-semibold text-foreground">3. Wallet Responsibility</h3>
                <p>You are solely responsible for safeguarding your seed phrase and private keys. HSMC cannot recover lost wallets. Never share your seed phrase with anyone.</p>
                <h3 className="text-base font-semibold text-foreground">4. Prohibited Activities</h3>
                <p>You may not use HSMC for money laundering, terrorist financing, sanctions evasion, or any illegal activity. Violations may result in account suspension and reporting to relevant authorities.</p>
                <h3 className="text-base font-semibold text-foreground">5. No Financial Advice</h3>
                <p>Nothing on this platform constitutes financial, investment, or legal advice. HSMC tokens are utility tokens. Engage with cryptocurrency at your own risk.</p>
                <h3 className="text-base font-semibold text-foreground">6. Limitation of Liability</h3>
                <p>HSMC is provided "as is". We are not liable for losses arising from smart contract bugs, network forks, or user error. Maximum liability is limited to fees paid in the 30 days prior to the claim.</p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ COOKIE POLICY */}
        <section id="cookies" className="container mx-auto px-4 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="max-w-3xl mx-auto glass-panel p-8">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <FileText className="w-6 h-6 text-primary" />
                Cookie Policy
              </h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p><strong className="text-foreground">Last updated: March 2026</strong></p>
                <h3 className="text-base font-semibold text-foreground">Cookies We Use</h3>
                <p>HSMC uses only <strong className="text-foreground">strictly necessary cookies</strong> for authentication session management (local auth token stored in localStorage). We do not use tracking, advertising, or analytics cookies.</p>
                <h3 className="text-base font-semibold text-foreground">Local Storage</h3>
                <p>We store your encrypted wallet seed phrase and UI preferences in your browser's localStorage. This data never leaves your device unencrypted.</p>
                <h3 className="text-base font-semibold text-foreground">Third-Party Cookies</h3>
                <p>We do not embed third-party trackers, advertising networks, or analytics SDKs. No data is shared with Google Analytics, Facebook Pixel, or similar services.</p>
                <h3 className="text-base font-semibold text-foreground">Managing Cookies</h3>
                <p>You can clear cookies and localStorage at any time through your browser settings. Note that clearing auth cookies will log you out, and clearing localStorage will remove your locally cached encrypted seed.</p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════════════════ CTA */}
        <section className="container mx-auto px-4 py-16 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <img
              src={hsmcLogo}
              alt="HSMC"
              className="h-16 w-auto mx-auto object-contain mb-6 opacity-70"
              draggable={false}
            />
            <h2 className="text-3xl font-bold mb-4">Ready to <span className="gradient-text">Launch</span>?</h2>
            <p className="text-muted-foreground mb-8">Configure your genesis block and start the mainnet journey</p>
            <div className="flex flex-wrap justify-center gap-4">
              <a href="/mainnet">
                <Button variant="hero" size="lg" className="gap-2">
                  <Cpu className="w-5 h-5" />
                  Open Mainnet Hub
                </Button>
              </a>
              <Button variant="outline" size="lg" onClick={handleDownload} className="gap-2">
                <Download className="w-5 h-5" />
                Download Whitepaper PDF
              </Button>
            </div>
          </motion.div>
        </section>
      </div>
    </div>
  );
}
