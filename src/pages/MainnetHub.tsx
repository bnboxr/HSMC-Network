import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Cpu, Server, Globe, Shield, CheckCircle2, Circle, ChevronRight,
  Download, Copy, Check, AlertTriangle, FileText, Coins, Scale,
  Terminal, Network, Zap, Lock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { SEO } from '@/components/SEO';

// ── Genesis Configurator ──────────────────────────────────────────────────────
interface GenesisConfig {
  chainId: number;
  networkName: string;
  symbol: string;
  totalSupply: number;
  blockTime: number;
  initialDifficulty: number;
  halvingInterval: number;
  initialReward: number;
  privacyProtocol: string;
  ringSize: number;
  genesisMessage: string;
  founderAddress: string;
}

const DEFAULT_GENESIS: GenesisConfig = {
  chainId: 7777,
  networkName: 'HSMC Mainnet',
  symbol: 'HSMC',
  totalSupply: 1_000_000_000_000,
  blockTime: 120,
  initialDifficulty: 4,
  halvingInterval: 210_000,
  initialReward: 50,
  privacyProtocol: 'RingCT-v2',
  ringSize: 11,
  genesisMessage: 'HSMC Genesis — Privacy is a Human Right',
  founderAddress: '',
};

// ── Checklist data ────────────────────────────────────────────────────────────
const PHASES = [
  {
    id: 'phase2',
    title: 'Faza 2 — Mainnet Launch',
    color: 'text-primary',
    border: 'border-primary/30',
    items: [
      { id: 'wp', label: 'Publică Whitepaper', detail: 'Whitepaper.tsx gata ✓ — exportează PDF și publică pe IPFS/GitHub Pages' },
      { id: 'audit', label: 'Audit securitate crypto', detail: 'Angajează Trail of Bits / Certik (~$15k-$50k) pentru Ring Signatures + RingCT' },
      { id: 'rust', label: 'Scrie nodul în Rust/Go', detail: 'Folosește spec-ul din memorie: HSMC Chain. Repo recomandat: substrate-based sau custom Rust.' },
      { id: 'vps', label: 'Lansează 5-10 noduri VPS', detail: 'Hetzner / DigitalOcean. Min 4 vCPU, 8GB RAM, 200GB SSD. Cost: ~$50-100/lună/nod.' },
      { id: 'genesis', label: 'Configurează & lansează Genesis Block', detail: 'Folosește configuratorul de mai jos → exportează genesis.json → rulează pe noduri.' },
      { id: 'miners', label: 'Aduce 5+ mineri externi', detail: 'Anunță pe Bitcointalk, Reddit r/altcoin, Discord crypto communities.' },
    ],
  },
  {
    id: 'phase3',
    title: 'Faza 3 — Lichiditate Reală',
    color: 'text-secondary',
    border: 'border-secondary/30',
    items: [
      { id: 'bep20', label: 'Deploy Wrapped HSMC (BEP-20)', detail: 'Smart contract pe BSC. Cost: ~$10-50 în BNB gas. Vezi contractul de mai jos.' },
      { id: 'bridge', label: 'Bridge contract mainnet ↔ BSC', detail: 'Multisig bridge sau trusted bridge la început. Upgrade la trustless mai târziu.' },
      { id: 'pancake', label: 'Creează pool PancakeSwap', detail: 'Adaugă lichiditate HSMC/BNB sau HSMC/USDT. Minim $1,000 recomandat.' },
      { id: 'cmc', label: 'Submit CoinMarketCap & CoinGecko', detail: 'Form gratuit. Necesită: contract address, logo, whitepaper, website. Durată: 2-4 săptămâni.' },
      { id: 'cex', label: 'Aplică pe Gate.io / MEXC', detail: 'Listing fee: $10k-$50k. Necesită: audit, whitepaper, comunitate activă (min 1k holders).' },
    ],
  },
  {
    id: 'phase4',
    title: 'Faza 4 — Legal & Compliance',
    color: 'text-amber-500',
    border: 'border-amber-500/30',
    items: [
      { id: 'legal', label: 'Consultanță juridică', detail: 'Cabinetele specializate crypto: Debevoise & Plimpton, MME Legal. ~$5k-$20k consultare inițială.' },
      { id: 'jurisdiction', label: 'Alege jurisdicție favorabilă', detail: 'Recomandate: Estonia, Malta, BVI, Cayman Islands, Elveția. Evită: USA (SEC), China.' },
      { id: 'kyc', label: 'KYC/AML dacă faci public sale', detail: 'Folosește Sumsub sau Jumio pentru KYC. Obligatoriu dacă colectezi fonduri de la public.' },
      { id: 'structure', label: 'Înființează entitate legală', detail: 'Foundation (non-profit) în Elveția/Estonia sau LLC în BVI. Separă foundation de team company.' },
      { id: 'tos', label: 'Terms of Service & Privacy Policy', detail: 'Necesare pentru website, wallet app, și exchange listings. Consultă avocat.' },
    ],
  },
];

const WRAPPED_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Wrapped HSMC (wHSMC) — BEP-20 / ERC-20
/// @notice 1:1 backed by native HSMC on HSMC mainnet
/// @dev Bridge mints/burns via authorized relayer
contract WrappedHSMC is ERC20, Ownable {
    address public bridge;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000 * 10**18;

    event BridgeMint(address indexed to, uint256 amount, bytes32 mainnetTxHash);
    event BridgeBurn(address indexed from, uint256 amount, string mainnetAddress);

    modifier onlyBridge() {
        require(msg.sender == bridge, "wHSMC: caller is not bridge");
        _;
    }

    constructor(address _bridge) ERC20("Wrapped HSMC", "wHSMC") Ownable(msg.sender) {
        bridge = _bridge;
    }

    /// @notice Bridge mints wHSMC when HSMC is locked on mainnet
    function mint(address to, uint256 amount, bytes32 mainnetTxHash) 
        external onlyBridge 
    {
        require(totalSupply() + amount <= MAX_SUPPLY, "wHSMC: exceeds max supply");
        _mint(to, amount);
        emit BridgeMint(to, amount, mainnetTxHash);
    }

    /// @notice User burns wHSMC to unlock HSMC on mainnet
    function burn(uint256 amount, string calldata mainnetAddress) external {
        _burn(msg.sender, amount);
        emit BridgeBurn(msg.sender, amount, mainnetAddress);
    }

    function setBridge(address _bridge) external onlyOwner {
        bridge = _bridge;
    }
}`;

const NODE_SETUP = `# HSMC Node Setup Guide
# ================================

# 1. Server Requirements (minimum)
# CPU: 4 vCPU | RAM: 8 GB | SSD: 200 GB | OS: Ubuntu 22.04

# 2. Install dependencies
sudo apt update && sudo apt install -y curl build-essential git
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 3. Clone & build node
git clone https://github.com/hsmc/node
cd node
cargo build --release

# 4. Initialize with genesis
./target/release/hsmc-node init --genesis genesis.json --datadir ~/.hsmc

# 5. Start node
./target/release/hsmc-node start \\
  --datadir ~/.hsmc \\
  --port 30303 \\
  --rpc-port 8545 \\
  --mining \\
  --miner-address YOUR_WALLET_ADDRESS

# 6. Check sync status
curl http://localhost:8545 -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"hsmc_blockNumber","id":1}'`;

const CHECKLIST_KEY = 'hsmc_mainnet_checklist_v1';

function loadChecklist(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveChecklist(state: Record<string, boolean>) {
  localStorage.setItem(CHECKLIST_KEY, JSON.stringify(state));
}

export default function MainnetHub() {
  const [genesis, setGenesis] = useState<GenesisConfig>(DEFAULT_GENESIS);
  const [checked, setChecked] = useState<Record<string, boolean>>(loadChecklist);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'checklist' | 'genesis' | 'contract' | 'node'>('checklist');

  const toggleCheck = (id: string) => {
    setChecked(p => {
      const next = { ...p, [id]: !p[id] };
      saveChecklist(next);
      return next;
    });
  };

  const totalItems = PHASES.flatMap(p => p.items).length;
  const doneItems = Object.values(checked).filter(Boolean).length;
  const progress = Math.round((doneItems / totalItems) * 100);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    toast({ title: 'Copiat în clipboard!' });
    setTimeout(() => setCopied(null), 2000);
  };

  const exportGenesis = () => {
    const json = {
      chainId: genesis.chainId,
      networkName: genesis.networkName,
      symbol: genesis.symbol,
      genesisBlock: {
        number: 0,
        timestamp: Date.now(),
        difficulty: genesis.initialDifficulty,
        nonce: '0x0000000000000042',
        extraData: `0x${Buffer.from(genesis.genesisMessage).toString('hex')}`,
        gasLimit: '0x1000000',
        coinbase: genesis.founderAddress || '0x0000000000000000000000000000000000000000',
        alloc: genesis.founderAddress ? {
          [genesis.founderAddress]: { balance: '0x' + (genesis.initialReward * 1e18).toString(16) }
        } : {},
      },
      params: {
        totalSupply: genesis.totalSupply,
        blockTime: genesis.blockTime,
        halvingInterval: genesis.halvingInterval,
        initialReward: genesis.initialReward,
        privacyProtocol: genesis.privacyProtocol,
        ringSize: genesis.ringSize,
      },
    };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'genesis.json';
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '✅ genesis.json exportat!' });
  };

  const TABS = [
    { id: 'checklist', label: 'Launch Checklist', icon: CheckCircle2 },
    { id: 'genesis', label: 'Genesis Config', icon: Cpu },
    { id: 'contract', label: 'wHSMC Contract', icon: Lock },
    { id: 'node', label: 'Node Setup', icon: Terminal },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="HSMC Mainnet Launch Hub — Genesis Configurator & Checklist"
        description="HSMC Mainnet command center: genesis configurator, validator onboarding checklist and launch readiness for the privacy blockchain."
        path="/mainnet"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "Launch an HSMC Mainnet Node",
          description: "Step-by-step guide to configure genesis and bring an HSMC mainnet node online.",
          step: [
            { "@type": "HowToStep", name: "Configure genesis block" },
            { "@type": "HowToStep", name: "Onboard validators" },
            { "@type": "HowToStep", name: "Verify launch readiness" }
          ]
        }}
      />

      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 glass py-3 px-6 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back
        </a>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-muted-foreground font-mono text-xs">{doneItems}/{totalItems} done</span>
          </div>
          <a href="/whitepaper">
            <Button variant="outline" size="sm" className="gap-2">
              <FileText className="w-4 h-4" />
              Whitepaper
            </Button>
          </a>
        </div>
      </div>

      <div className="pt-20 pb-20 container mx-auto px-4">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-mono mb-6">
            <Zap className="w-4 h-4" />
            Mainnet Launch Hub
          </div>
          <h1 className="text-5xl font-black mb-4">
            <span className="gradient-text">HSMC</span> Mainnet
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Tot ce ai nevoie pentru Faza 2, 3 și 4 — checklist, genesis configurator, contract wHSMC și ghid de node setup.
          </p>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {[
            { icon: Network, label: 'Chain ID', value: genesis.chainId.toString() },
            { icon: Coins, label: 'Total Supply', value: '1T HSMC' },
            { icon: Server, label: 'Block Time', value: `${genesis.blockTime}s` },
            { icon: Shield, label: 'Privacy', value: genesis.privacyProtocol },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="glass-panel p-4 text-center">
              <Icon className="w-5 h-5 text-primary mx-auto mb-2" />
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-bold font-mono text-sm">{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-8">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTab === id
                  ? 'bg-primary/10 border border-primary/30 text-primary'
                  : 'bg-muted/30 border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* TAB: Checklist */}
        {activeTab === 'checklist' && (
          <div className="space-y-8">
            {PHASES.map(({ id, title, color, border, items }) => (
              <motion.div key={id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={`glass-panel border-l-4 ${border}`}>
                <h2 className={`text-xl font-bold mb-6 ${color}`}>{title}</h2>
                <div className="space-y-3">
                  {items.map(item => (
                    <div
                      key={item.id}
                      onClick={() => toggleCheck(item.id)}
                      className={`flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all ${
                        checked[item.id] ? 'bg-secondary/10 border border-secondary/20' : 'bg-muted/20 hover:bg-muted/40 border border-transparent'
                      }`}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        {checked[item.id]
                          ? <CheckCircle2 className="w-5 h-5 text-secondary" />
                          : <Circle className="w-5 h-5 text-muted-foreground" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-semibold text-sm ${checked[item.id] ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {item.label}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}

            {/* Legal Warning */}
            <div className="glass-panel border border-amber-500/30 bg-amber-500/5 p-6">
              <div className="flex items-start gap-4">
                <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-amber-500 mb-2">⚠️ Important Legal Warning</h3>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li>• <strong className="text-foreground">NU face ICO public</strong> fără consultanță juridică — riști sancțiuni SEC/ESMA</li>
                    <li>• <strong className="text-foreground">KYC obligatoriu</strong> dacă colectezi fonduri de la utilizatori (GDPR + AMLD5 în EU)</li>
                    <li>• <strong className="text-foreground">Audit obligatoriu</strong> înainte de DEX listing — fără audit, exchange-urile NU te listează</li>
                    <li>• <strong className="text-foreground">Tokenele fără utilitate reală</strong> pot fi clasificate ca securities — asigură-te că HSMC are use case clar</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: Genesis Configurator */}
        {activeTab === 'genesis' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold">Genesis Block Configurator</h2>
                <p className="text-sm text-muted-foreground mt-1">Configurează parametrii chainului tău și exportează genesis.json</p>
              </div>
              <Button variant="hero" onClick={exportGenesis} className="gap-2">
                <Download className="w-4 h-4" />
                Export genesis.json
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { key: 'networkName', label: 'Network Name', type: 'text' },
                { key: 'symbol', label: 'Symbol', type: 'text' },
                { key: 'chainId', label: 'Chain ID', type: 'number' },
                { key: 'totalSupply', label: 'Total Supply', type: 'number' },
                { key: 'blockTime', label: 'Block Time (seconds)', type: 'number' },
                { key: 'initialDifficulty', label: 'Initial Difficulty (leading zeros)', type: 'number' },
                { key: 'halvingInterval', label: 'Halving Interval (blocks)', type: 'number' },
                { key: 'initialReward', label: 'Initial Block Reward (HSMC)', type: 'number' },
                { key: 'ringSize', label: 'Ring Size (privacy)', type: 'number' },
                { key: 'founderAddress', label: 'Founder Address (0x...)', type: 'text' },
                { key: 'genesisMessage', label: 'Genesis Message', type: 'text' },
                { key: 'privacyProtocol', label: 'Privacy Protocol', type: 'text' },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground mb-1.5 block font-mono">{label}</label>
                  <Input
                    type={type}
                    value={(genesis as any)[key]}
                    onChange={e => setGenesis(p => ({ ...p, [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="mt-8 p-4 bg-muted/30 rounded-xl border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground font-mono">genesis.json preview</span>
                <button onClick={() => handleCopy(JSON.stringify(genesis, null, 2), 'genesis')} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
                  {copied === 'genesis' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  Copy
                </button>
              </div>
              <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {JSON.stringify({ chainId: genesis.chainId, networkName: genesis.networkName, symbol: genesis.symbol, params: { totalSupply: genesis.totalSupply, blockTime: genesis.blockTime, halvingInterval: genesis.halvingInterval, initialReward: genesis.initialReward, privacyProtocol: genesis.privacyProtocol, ringSize: genesis.ringSize }, genesisMessage: genesis.genesisMessage }, null, 2)}
              </pre>
            </div>
          </motion.div>
        )}

        {/* TAB: Wrapped Contract */}
        {activeTab === 'contract' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">Wrapped HSMC — BEP-20 Contract</h2>
                <p className="text-sm text-muted-foreground mt-1">Deploy pe BSC cu Hardhat sau Remix IDE. Cost estimat: $10-50 în BNB gas.</p>
              </div>
              <Button variant="outline" onClick={() => handleCopy(WRAPPED_CONTRACT, 'contract')} className="gap-2">
                {copied === 'contract' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                Copy Contract
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Standard', value: 'ERC-20 / BEP-20' },
                { label: 'Max Supply', value: '1,000,000,000,000 wHSMC' },
                { label: 'Mechanism', value: 'Mint/Burn Bridge' },
              ].map(({ label, value }) => (
                <div key={label} className="p-4 bg-muted/30 rounded-xl border border-border text-center">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="font-bold text-sm mt-1">{value}</div>
                </div>
              ))}
            </div>

            <pre className="text-xs text-green-400 bg-black/50 rounded-xl p-6 overflow-x-auto leading-relaxed border border-border">
              {WRAPPED_CONTRACT}
            </pre>

            <div className="mt-6 p-4 bg-primary/5 border border-primary/20 rounded-xl">
              <h3 className="font-semibold mb-3 text-sm">🚀 Cum deployezi pe BSC Mainnet:</h3>
              <ol className="text-sm text-muted-foreground space-y-2">
                <li>1. Instalează: <code className="text-primary bg-primary/10 px-1 rounded">npm install --save-dev hardhat @openzeppelin/contracts</code></li>
                <li>2. Creează walletul bridge: <code className="text-primary bg-primary/10 px-1 rounded">npx hardhat accounts</code></li>
                <li>3. Deploy: <code className="text-primary bg-primary/10 px-1 rounded">npx hardhat run scripts/deploy.js --network bsc</code></li>
                <li>4. Verifică pe BSCScan: <code className="text-primary bg-primary/10 px-1 rounded">npx hardhat verify --network bsc CONTRACT_ADDRESS</code></li>
                <li>5. Adaugă lichiditate pe PancakeSwap cu adresa contractului</li>
              </ol>
            </div>
          </motion.div>
        )}

        {/* TAB: Node Setup */}
        {activeTab === 'node' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">Node Setup Guide</h2>
                <p className="text-sm text-muted-foreground mt-1">Ghid complet pentru a rula un nod HSMC pe VPS.</p>
              </div>
              <Button variant="outline" onClick={() => handleCopy(NODE_SETUP, 'node')} className="gap-2">
                {copied === 'node' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                Copy Script
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'CPU', value: '4 vCPU min' },
                { label: 'RAM', value: '8 GB min' },
                { label: 'SSD', value: '200 GB min' },
                { label: 'Cost', value: '~$50/lună' },
              ].map(({ label, value }) => (
                <div key={label} className="p-4 bg-muted/30 rounded-xl border border-border text-center">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="font-bold text-sm mt-1">{value}</div>
                </div>
              ))}
            </div>

            <pre className="text-xs text-green-400 bg-black/50 rounded-xl p-6 overflow-x-auto leading-relaxed border border-border">
              {NODE_SETUP}
            </pre>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-secondary/5 border border-secondary/20 rounded-xl">
                <h3 className="font-semibold text-secondary mb-3 text-sm">✅ Recomandări VPS</h3>
                <ul className="text-xs text-muted-foreground space-y-1.5">
                  <li>• <strong className="text-foreground">Hetzner</strong> — CPX31 €12/lună (cel mai bun raport)</li>
                  <li>• <strong className="text-foreground">DigitalOcean</strong> — $48/lună, bun pentru US latency</li>
                  <li>• <strong className="text-foreground">Vultr</strong> — $24/lună, 18 locații globale</li>
                  <li>• <strong className="text-foreground">AWS EC2</strong> — t3.xlarge ~$120/lună, enterprise grade</li>
                </ul>
              </div>
              <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <h3 className="font-semibold text-amber-500 mb-3 text-sm">⚠️ Noduri necesare la launch</h3>
                <ul className="text-xs text-muted-foreground space-y-1.5">
                  <li>• Minim <strong className="text-foreground">5 noduri</strong> geografic distribuite</li>
                  <li>• Minim <strong className="text-foreground">2 noduri</strong> cu mining activ</li>
                  <li>• Minim <strong className="text-foreground">1 nod</strong> RPC public pentru wallet/explorer</li>
                  <li>• Recomandat: EU, US, Asia pentru redundanță</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* CTA Footer */}
      <div className="fixed bottom-0 left-0 right-0 glass py-4 px-6 flex items-center justify-between border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">Mainnet <span className="text-amber-500 font-semibold">Pre-Launch</span></span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/whitepaper">
            <Button variant="outline" size="sm" className="gap-2">
              <Globe className="w-4 h-4" />
              Whitepaper
            </Button>
          </a>
          <a href="/node">
            <Button variant="hero" size="sm" className="gap-2">
              <Cpu className="w-4 h-4" />
              Node Dashboard
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
