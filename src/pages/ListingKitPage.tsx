import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Copy, Check, Download, ChevronRight, Globe, FileText,
  Link2, Layers, ArrowLeftRight, Shield, Cpu, AlertTriangle,
  CheckCircle2, Circle, ExternalLink, Zap, GitBranch
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

// ── Bridge Architecture ──────────────────────────────────────────────────────
const BRIDGES = [
  {
    id: 'bsc',
    name: 'BSC Bridge',
    chain: 'BNB Smart Chain',
    symbol: 'wHSMC-BSC',
    color: 'text-yellow-500',
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/5',
    dex: 'PancakeSwap',
    cost: '~$10-50 in BNB gas',
    time: '1-2 săptămâni',
    difficulty: 'Ușor',
    priority: '1st',
    contract: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// wHSMC BEP-20 on BSC — vezi /mainnet pentru contractul complet
// Deploy pe: https://remix.ethereum.org
// Network: BSC Mainnet (Chain ID: 56) sau Testnet (97)`,
    steps: [
      'Deploy WrappedHSMC.sol pe BSC cu bridge address = multisig wallet tău',
      'Adaugă hsmc_bridgeLock în nodul Rust (metoda RPC gata în /rust-node)',
      'Creează Edge Function relayer: ascultă pe events BSC → unlock pe HSMC mainnet',
      'Adaugă lichiditate wHSMC/BUSD pe PancakeSwap (min $1k)',
      'Submit contract pe BSCScan pentru verificare (obliga pentru trustl)',
    ],
  },
  {
    id: 'eth',
    name: 'Ethereum Bridge',
    chain: 'Ethereum Mainnet',
    symbol: 'wHSMC-ETH',
    color: 'text-blue-400',
    border: 'border-blue-400/30',
    bg: 'bg-blue-400/5',
    dex: 'Uniswap V3',
    cost: '~$50-200 în ETH gas',
    time: '2-4 săptămâni',
    difficulty: 'Mediu',
    priority: '2nd',
    contract: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// wHSMC ERC-20 on Ethereum — același contract ca BSC
// Deploy pe: Ethereum Mainnet (Chain ID: 1) sau Sepolia Testnet (11155111)
// Folosește Alchemy/Infura ca RPC provider`,
    steps: [
      'Deployezi același contract WrappedHSMC.sol pe Ethereum (ERC-20 identic cu BEP-20)',
      'Adaugă ETH bridge support în relayer-ul tău (Edge Function separată)',
      'Adaugă lichiditate wHSMC/ETH sau wHSMC/USDC pe Uniswap V3',
      'Gas mai scump decât BSC — recomandat după ce ai tracțiune pe BSC',
      'Submit pe Etherscan pentru verificare',
    ],
  },
  {
    id: 'polygon',
    name: 'Polygon Bridge',
    chain: 'Polygon PoS',
    symbol: 'wHSMC-MATIC',
    color: 'text-purple-400',
    border: 'border-purple-400/30',
    bg: 'bg-purple-400/5',
    dex: 'QuickSwap',
    cost: '~$1-5 în MATIC gas',
    time: '1-2 săptămâni',
    difficulty: 'Ușor',
    priority: '3rd',
    contract: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// wHSMC pe Polygon — cel mai ieftin gas, bun pentru testare volume
// Chain ID: 137 (Mainnet) sau 80001 (Mumbai Testnet)
// Rapid, cheap, dar lichiditate mai mică decât BSC/ETH`,
    steps: [
      'Deploy același WrappedHSMC.sol pe Polygon (Chain ID: 137)',
      'Gas extrem de ieftin (~$0.01 per tx) — perfect pentru volume mare',
      'Adaugă lichiditate pe QuickSwap sau SushiSwap',
      'Polygon are integrare nativă cu Ethereum — ușor de bridguit și spre ETH',
    ],
  },
  {
    id: 'solana',
    name: 'Solana Bridge',
    chain: 'Solana',
    symbol: 'wHSMC-SOL',
    color: 'text-green-400',
    border: 'border-green-400/30',
    bg: 'bg-green-400/5',
    dex: 'Raydium / Jupiter',
    cost: '~$5-20 deployment',
    time: '3-6 săptămâni',
    difficulty: 'Complex',
    priority: '4th',
    contract: `// Solana folosește Rust + SPL Token standard (nu Solidity)
// Trebuie să scrii un SPL Token Mint program + Wormhole bridge
// Mult mai complex decât EVM chains — recomand după BSC + ETH`,
    steps: [
      'Solana NU folosește Solidity — trebuie Rust + Anchor framework',
      'Creează SPL Token Mint pentru wHSMC pe Solana',
      'Folosește Wormhole protocol pentru cross-chain messaging',
      'Alternativ: Allbridge sau deBridge pentru simplitate',
      'Adaugă lichiditate pe Raydium sau Orca DEX',
    ],
  },
];

// ── Exchange Listing Checklist ────────────────────────────────────────────────
const EXCHANGES = [
  {
    name: 'Gate.io',
    tier: 'Tier 2',
    fee: '$10k-$30k',
    requirements: ['Contract audit', 'Min 1000 holders', 'Whitepaper', 'CMC listed', 'Active community'],
    url: 'https://www.gate.io/listing',
  },
  {
    name: 'MEXC',
    tier: 'Tier 2',
    fee: 'Varies (nego)',
    requirements: ['BSC/ETH contract', 'Community votes', 'Whitepaper', 'Min 500 holders'],
    url: 'https://support.mexc.com/hc/en-001/requests/new',
  },
  {
    name: 'CoinMarketCap',
    tier: 'Data site',
    fee: 'Free',
    requirements: ['Contract address', 'Logo 200x200', 'Website', 'Whitepaper URL', 'Social links'],
    url: 'https://coinmarketcap.com/request/',
  },
  {
    name: 'CoinGecko',
    tier: 'Data site',
    fee: 'Free',
    requirements: ['Contract address', 'Logo 200x200', 'Website', 'Description', 'Social links'],
    url: 'https://www.coingecko.com/en/coins/new',
  },
];

const LISTING_MATERIALS = [
  { label: 'Token Name', value: 'HSMC' },
  { label: 'Symbol', value: 'HSMC' },
  { label: 'Decimals', value: '18' },
  { label: 'Total Supply', value: '1,000,000,000,000 HSMC' },
  { label: 'Chain (primary)', value: 'HSMC Mainnet (custom)' },
  { label: 'Wrapped Token', value: 'wHSMC (BEP-20 on BSC)' },
  { label: 'Contract Standard', value: 'ERC-20 / BEP-20 compatible' },
  { label: 'Consensus', value: 'SHA-256d PoW' },
  { label: 'Privacy Protocol', value: 'RingCT v2 + Ring Signatures' },
  { label: 'Block Time', value: '~120 seconds' },
  { label: 'Whitepaper URL', value: 'your-domain.com/whitepaper' },
  { label: 'GitHub', value: 'github.com/hsmc/node' },
];

const BRIDGE_RUST_CODE = `// crates/hsmc-rpc/src/bridge.rs — Bridge relayer integration

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Called by Edge Function when HSMCPay payment completes OR
/// when user initiates a manual bridge from frontend
#[derive(Deserialize)]
pub struct BridgeRequest {
    pub direction: BridgeDirection,
    pub amount: u64,           // in HSMC base units (1 HSMC = 1_000_000)
    pub source_address: String, // HSMC address (0x...)
    pub dest_address: String,  // BSC/ETH/Polygon address (0x...)
    pub dest_chain: DestChain,
    pub payment_ref: Option<String>, // from HSMCPay session_id
}

#[derive(Deserialize, Serialize, Clone)]
pub enum BridgeDirection {
    Lock,    // HSMC mainnet → wHSMC on EVM chain
    Unlock,  // wHSMC burn on EVM → HSMC mainnet
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub enum DestChain {
    BSC,        // Chain ID 56
    Ethereum,   // Chain ID 1
    Polygon,    // Chain ID 137
}

impl DestChain {
    pub fn chain_id(&self) -> u64 {
        match self { Self::BSC => 56, Self::Ethereum => 1, Self::Polygon => 137 }
    }
    pub fn rpc_url(&self) -> &str {
        match self {
            Self::BSC      => "https://bsc-dataseed.binance.org",
            Self::Ethereum => "https://mainnet.infura.io/v3/YOUR_KEY",
            Self::Polygon  => "https://polygon-rpc.com",
        }
    }
    pub fn whsmc_contract(&self) -> &str {
        match self {
            Self::BSC      => "0xYOUR_BSC_CONTRACT_ADDRESS",
            Self::Ethereum => "0xYOUR_ETH_CONTRACT_ADDRESS",
            Self::Polygon  => "0xYOUR_POLYGON_CONTRACT_ADDRESS",
        }
    }
}

pub async fn bridge_lock(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BridgeRequest>,
) -> Json<serde_json::Value> {
    // 1. Validate HSMC mainnet address has enough balance
    let balance = state.chain.read().await.get_balance(&req.source_address);
    if balance < req.amount {
        return Json(serde_json::json!({ "error": "Insufficient balance" }));
    }

    // 2. Create BridgeLock transaction on HSMC mainnet
    let lock_tx = Transaction {
        tx_type: TxType::BridgeLock,
        from_address: Some(hex_to_addr(&req.source_address)),
        amount: Some(req.amount),
        extra: format!("{}:{}", req.dest_chain.chain_id(), req.dest_address).into_bytes(),
        ..Default::default()
    };
    let tx_hash = lock_tx.hash_hex();
    state.mempool.write().await.add(lock_tx);

    // 3. Return calldata for EVM bridge contract
    // Edge Function will sign + submit this to EVM chain
    let mint_calldata = encode_whsmc_mint(
        &req.dest_address,
        req.amount,
        &tx_hash,
    );

    Json(serde_json::json!({
        "ok": true,
        "mainnet_tx_hash": tx_hash,
        "evm_chain_id": req.dest_chain.chain_id(),
        "evm_contract": req.dest_chain.whsmc_contract(),
        "mint_calldata": mint_calldata,
        "amount": req.amount,
    }))
}

/// ABI encode: wHSMC.mint(address to, uint256 amount, bytes32 mainnetTxHash)
fn encode_whsmc_mint(to: &str, amount: u64, tx_hash: &str) -> String {
    // In production use ethabi crate:
    // use ethabi::{Contract, Token};
    // For now return hex placeholder
    format!("0x40c10f19{:0>64}{:0>64}{}", 
        to.trim_start_matches("0x"),
        format!("{:x}", amount),
        tx_hash.trim_start_matches("0x"),
    )
}`;

export default function ListingKitPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'bridges' | 'listing' | 'materials' | 'code'>('bridges');
  const [activeBridge, setActiveBridge] = useState('bsc');

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    toast({ title: '✅ Copiat!' });
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownloadKit = () => {
    const content = [
      'HSMC EXCHANGE LISTING KIT',
      '='.repeat(50),
      '',
      '1. TOKEN INFORMATION',
      ...LISTING_MATERIALS.map(m => `${m.label}: ${m.value}`),
      '',
      '2. EXCHANGE LINKS',
      ...EXCHANGES.map(e => `${e.name} (${e.tier}): ${e.url}`),
      '',
      '3. REQUIREMENTS CHECKLIST',
      ...EXCHANGES.flatMap(e => [`\n${e.name}:`, ...e.requirements.map(r => `  - ${r}`)]),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'HSMC-Listing-Kit.txt'; a.click();
    URL.revokeObjectURL(url);
    toast({ title: '📥 Listing Kit descărcat!' });
  };

  const bridge = BRIDGES.find(b => b.id === activeBridge)!;

  const TABS = [
    { id: 'bridges', label: 'Bridge Architecture', icon: ArrowLeftRight },
    { id: 'listing', label: 'Exchange Checklist', icon: CheckCircle2 },
    { id: 'materials', label: 'Listing Materials', icon: FileText },
    { id: 'code', label: 'Rust Bridge Code', icon: Cpu },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed top-0 left-0 right-0 z-50 glass py-3 px-6 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className="w-4 h-4 rotate-180" />Back
        </a>
        <div className="flex items-center gap-2">
          <a href="/investors"><Button variant="outline" size="sm">Investors</Button></a>
          <Button variant="hero" size="sm" onClick={handleDownloadKit} className="gap-2">
            <Download className="w-4 h-4" />Download Kit
          </Button>
        </div>
      </div>

      <div className="pt-20 pb-20 container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-mono mb-6">
            <Link2 className="w-4 h-4" />Exchange Listing Kit + Bridge Architecture
          </div>
          <h1 className="text-5xl font-black mb-4">
            <span className="gradient-text">HSMC</span> on Every Chain
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Bridge architecture pentru BSC, ETH, Polygon, Solana — plus tot ce ai nevoie pentru Gate.io și MEXC listing.
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-8">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === id ? 'bg-primary/10 border border-primary/30 text-primary' : 'bg-muted/30 border border-border text-muted-foreground hover:text-foreground'}`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {/* ── TAB: Bridge Architecture ── */}
        {activeTab === 'bridges' && (
          <div className="space-y-6">
            {/* Overview diagram */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-primary" />
                Bridge Architecture — Lock & Mint
              </h2>
              <div className="relative overflow-x-auto">
                <div className="flex items-center justify-between gap-4 min-w-[600px] py-4">
                  {/* HSMC Mainnet */}
                  <div className="flex-1 glass-card p-4 text-center border border-primary/30">
                    <Shield className="w-8 h-8 text-primary mx-auto mb-2" />
                    <div className="font-bold text-sm">HSMC Mainnet</div>
                    <div className="text-xs text-muted-foreground">Rust node</div>
                    <div className="text-xs font-mono text-primary mt-1">Chain ID: 7777</div>
                  </div>
                  {/* Relayer */}
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-xs text-muted-foreground text-center">Lock → Mint</div>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-0.5 bg-gradient-to-r from-primary to-secondary" />
                      <ArrowLeftRight className="w-5 h-5 text-primary" />
                      <div className="w-16 h-0.5 bg-gradient-to-r from-secondary to-primary" />
                    </div>
                    <div className="text-xs text-muted-foreground text-center">Burn → Unlock</div>
                    <div className="p-2 bg-primary/10 rounded-lg border border-primary/20 text-xs text-center">
                      <Zap className="w-3 h-3 text-primary mx-auto mb-1" />
                      Edge Function<br/>Relayer
                    </div>
                  </div>
                  {/* EVM Chains */}
                  <div className="flex-1 space-y-2">
                    {BRIDGES.map(b => (
                      <button key={b.id} onClick={() => setActiveBridge(b.id)}
                        className={`w-full p-3 rounded-xl border text-left transition-all ${activeBridge === b.id ? `${b.border} ${b.bg}` : 'border-border hover:border-muted-foreground/30'}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className={`font-bold text-xs ${b.color}`}>{b.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">{b.symbol}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{b.priority}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{b.dex} • {b.cost}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Selected bridge detail */}
            <motion.div key={activeBridge} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`glass-panel border ${bridge.border} ${bridge.bg}`}>
              <div className="flex items-center gap-4 mb-6">
                <div>
                  <h3 className={`text-2xl font-bold ${bridge.color}`}>{bridge.name}</h3>
                  <p className="text-sm text-muted-foreground">{bridge.chain} • DEX: {bridge.dex}</p>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-sm font-bold">{bridge.cost}</div>
                  <div className="text-xs text-muted-foreground">{bridge.difficulty} • {bridge.time}</div>
                </div>
              </div>

              <h4 className="font-semibold text-sm mb-3">Pași de implementare:</h4>
              <ol className="space-y-2 mb-6">
                {bridge.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${bridge.bg} border ${bridge.border} ${bridge.color}`}>{i+1}</span>
                    <span className="text-muted-foreground pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-mono">Contract snippet</span>
                  <button onClick={() => handleCopy(bridge.contract, bridge.id)} className="text-xs text-primary flex items-center gap-1">
                    {copied === bridge.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}Copy
                  </button>
                </div>
                <pre className="text-xs font-mono text-emerald-400 bg-card/80 rounded-xl p-4 overflow-x-auto border border-border">{bridge.contract}</pre>
              </div>
            </motion.div>

            {/* Priority recommendation */}
            <div className="glass-panel border border-secondary/20 bg-secondary/5 p-6">
              <h3 className="font-bold text-secondary mb-3">✅ Ordinea recomandată pentru HSMC</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {BRIDGES.map(b => (
                  <div key={b.id} className={`p-3 rounded-xl border ${b.border} ${b.bg} text-center`}>
                    <div className="text-lg font-black">{b.priority}</div>
                    <div className={`font-bold text-sm ${b.color}`}>{b.chain.split(' ')[0]}</div>
                    <div className="text-xs text-muted-foreground">{b.difficulty}</div>
                    <div className="text-[10px] text-muted-foreground">{b.cost}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: Exchange Checklist ── */}
        {activeTab === 'listing' && (
          <div className="space-y-6">
            {EXCHANGES.map((ex, ei) => (
              <motion.div key={ex.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: ei * 0.1 }} className="glass-panel">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-xl font-bold">{ex.name}</h3>
                    <p className="text-sm text-muted-foreground">{ex.tier} • Listing fee: {ex.fee}</p>
                  </div>
                  <a href={ex.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2">
                      <ExternalLink className="w-3 h-3" />Apply
                    </Button>
                  </a>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ex.requirements.map((req, ri) => {
                    const key = `${ex.name}-${ri}`;
                    return (
                      <div key={ri} onClick={() => setChecked(p => ({ ...p, [key]: !p[key] }))}
                        className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${checked[key] ? 'bg-secondary/10 border border-secondary/20' : 'bg-muted/20 border border-transparent hover:bg-muted/40'}`}>
                        {checked[key] ? <CheckCircle2 className="w-4 h-4 text-secondary flex-shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                        <span className={`text-sm ${checked[key] ? 'line-through text-muted-foreground' : ''}`}>{req}</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* ── TAB: Listing Materials ── */}
        {activeTab === 'materials' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Token Information Sheet</h2>
              <button onClick={() => handleCopy(LISTING_MATERIALS.map(m => `${m.label}: ${m.value}`).join('\n'), 'materials')}
                className="flex items-center gap-2 text-sm text-primary hover:text-primary/80">
                {copied === 'materials' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}Copy All
              </button>
            </div>
            <div className="space-y-2">
              {LISTING_MATERIALS.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between p-4 bg-muted/20 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                  <span className="text-sm text-muted-foreground font-mono">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold font-mono">{value}</span>
                    <button onClick={() => handleCopy(value, label)} className="text-muted-foreground hover:text-primary">
                      {copied === label ? <Check className="w-3 h-3 text-secondary" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <div className="flex items-start gap-3 text-sm text-muted-foreground">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p>Înainte de listing completează:</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    <li>• Logo PNG/SVG 200×200px (fundal transparent)</li>
                    <li>• Website cu whitepaper accesibil public</li>
                    <li>• Twitter + Telegram + GitHub activ (min 100 urmăritori fiecare)</li>
                    <li>• Smart contract deployed + verificat pe BSCScan/Etherscan</li>
                    <li>• Audit securitate (cel puțin un audit intern documentat)</li>
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── TAB: Rust Bridge Code ── */}
        {activeTab === 'code' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold">Rust Bridge Code</h2>
                <p className="text-sm text-muted-foreground">Cod gata pentru nodul tău Rust — suportă BSC, ETH, Polygon</p>
              </div>
              <button onClick={() => handleCopy(BRIDGE_RUST_CODE, 'rust')} className="flex items-center gap-2 text-sm text-primary">
                {copied === 'rust' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}Copy
              </button>
            </div>
            <pre className="text-xs font-mono text-emerald-400 bg-card/80 rounded-xl p-5 overflow-x-auto leading-relaxed border border-border max-h-[600px] overflow-y-auto">
              {BRIDGE_RUST_CODE}
            </pre>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                <h3 className="font-semibold text-sm mb-3 text-primary">🦀 Dependențe Cargo pentru bridge</h3>
                <pre className="text-xs font-mono text-muted-foreground">{`# Adaugă în Cargo.toml:
ethabi = "18"          # ABI encoding
ethers = "2"           # ETH/BSC client
web3 = "0.19"          # Alternativă
hex = "0.4"            # Hex encoding`}</pre>
              </div>
              <div className="p-4 bg-secondary/5 border border-secondary/20 rounded-xl">
                <h3 className="font-semibold text-sm mb-3 text-secondary">⚡ Edge Function Relayer</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Edge Function (TypeScript) ascultă pe `hsmc_bridgeLock` events din Rust node,
                  semnează tx cu bridge wallet key (stocat în local keystore),
                  și submitit tranzacția pe BSC/ETH/Polygon.
                </p>
                <a href="/rust-node">
                  <Button variant="outline" size="sm" className="mt-3 gap-2 w-full">
                    <GitBranch className="w-3 h-3" />Rust Node Spec complet
                  </Button>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
