import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  BookOpen,
  Box,
  Network,
  FileCode,
  Terminal,
  Cpu,
  Shield,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';

const docSections = [
  {
    id: 'core',
    title: 'Core Blockchain',
    icon: Box,
    content: [
      {
        title: 'Overview',
        content: `HSMC Chain este un blockchain de generație nouă cu privacy nativ, inspirat de Monero (XMR) și extins cu Proof-of-Stake și Smart Contracts.

Key Features:
• Ring Signatures (ring size 11–16) — identic cu Monero
• Stealth Addresses — adrese de unică folosință per tranzacție
• Confidential Transactions (RingCT + Bulletproofs)
• Dandelion++ pentru IP obfuscation
• Proof-of-Stake cu validator rotation și slashing
• Smart Contracts privacy-aware (WASM runtime)
• ~60 second block time (PoW)
• TPS: 850–2500 tranzacții/secundă`,
      },
      {
        title: 'Architecture',
        content: `HSMC Chain are 4 straturi principale:

1. **Privacy Layer (Rust)**: Ring Signatures, Stealth Addresses, RingCT, Bulletproofs — cryptografie pură.
2. **Consensus Layer (Go)**: PoS cu validator rotation, BFT finality, slashing pentru comportament rău.
3. **Networking Layer (Go/libp2p)**: Gossip protocol, DHT peer discovery, Dandelion++ propagation.
4. **Execution Layer**: WASM runtime pentru smart contracts cu privacy-preserving state.

Toate comunicațiile inter-layer folosesc gRPC intern. API-ul extern expune REST + WebSocket.`,
      },
      {
        title: 'Block Structure',
        content: `Fiecare block HSMC conține:

\`\`\`rust
struct Block {
    header: BlockHeader {
        number: u64,
        parent_hash: Hash256,
        merkle_root: Hash256,
        timestamp: u64,
        validator: PublicKey,
        difficulty: u64,
        nonce: u64,
        privacy_protocol: "RingCT-v2",
    },
    transactions: Vec<PrivacyTransaction>,
    validator_signature: RingSignature,
    epoch: u32,
}
\`\`\``,
        hasCode: true,
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy Protocol',
    icon: Shield,
    content: [
      {
        title: 'Ring Signatures',
        content: `Ring Signatures ascund expeditorul real al unei tranzacții.

\`\`\`rust
// Ring size: 11 (standard), 16 (maximum privacy)
struct RingSignature {
    key_images: Vec<CompressedPoint>,  // Previne double-spend
    c: Scalar,                          // Challenge
    r: Vec<Scalar>,                     // Responses (one per decoy)
}
\`\`\`

Procesul:
1. Se selectează 10–15 decoy outputs din blockchain
2. Se creează key image din spend key: I = x * Hp(P)
3. Se semnează cu Schnorr Ring Signature
4. Validatorul verifică fără a ști care e real`,
        hasCode: true,
      },
      {
        title: 'Stealth Addresses',
        content: `Fiecare tranzacție folosește o adresă de unică folosință.

\`\`\`rust
// Expeditor calculează stealth address:
// r = random scalar
// R = r * G (transmitted as tx_pub_key)
// P_stealth = Hs(r * B) * G + S  
// Unde B = view key, S = spend key

fn generate_stealth(view_pub: &Point, spend_pub: &Point) -> (Point, Scalar) {
    let r = Scalar::random();
    let shared_secret = r * view_pub;
    let stealth = hash_to_scalar(shared_secret) * G + spend_pub;
    (stealth, r)
}
\`\`\``,
        hasCode: true,
      },
      {
        title: 'Confidential Transactions (RingCT)',
        content: `Sumele sunt ascunse prin Pedersen Commitments.

\`\`\`rust
// Commitment: C = amount * H + blinding_factor * G
// Range proof (Bulletproof): dovedește 0 ≤ amount < 2^64
// Verificare: C_inputs = C_outputs + fee * H

struct ConfidentialTx {
    input_commitments: Vec<PedersenCommitment>,
    output_commitments: Vec<PedersenCommitment>,
    range_proofs: Vec<Bulletproof>,  // ~700 bytes each
    fee: u64,  // Singura valoare publică
}
\`\`\``,
        hasCode: true,
      },
      {
        title: 'Dandelion++ (IP Privacy)',
        content: `Previne legarea IP-ului de tranzacție.

Faze:
1. **Stem phase** (anonimity set): Tranzacția e trimisă printr-un lanț de noduri aleatoare (nu broadcast)
2. **Fluff phase**: La un nod random, se face broadcast normal

Rezultat: Originea reală a tranzacției e imposibil de determinat chiar dacă un adversar controlează noduri în rețea.`,
      },
    ],
  },
  {
    id: 'nodes',
    title: 'Nodes & Validators',
    icon: Network,
    content: [
      {
        title: 'Node Types',
        content: `HSMC supports multiple node types:

**Full Nodes**: Store complete blockchain data and validate all transactions.

**Light Nodes**: Store only block headers, ideal for mobile applications.

**Archive Nodes**: Store historical state data for analytics and debugging.

**Validator Nodes**: Participate in consensus and block production.`,
      },
      {
        title: 'Running a Node',
        content: `To run an HSMC node:

\`\`\`bash
# Install the HSMC client
curl -sSL https://install.hsmc.io | bash

# Initialize the node
hsmc init --network mainnet

# Start the node
hsmc start --rpc --ws
\`\`\``,
        hasCode: true,
      },
      {
        title: 'Becoming a Validator',
        content: `Requirements for validators:
• Minimum stake: 10,000 HSMC
• 99.9% uptime commitment
• Hardware: 8+ CPU cores, 32GB RAM, 1TB SSD
• Bandwidth: 100Mbps+ symmetric

Validators earn rewards for producing blocks and participating in consensus.`,
      },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions',
    icon: FileCode,
    content: [
      {
        title: 'Transaction Types',
        content: `HSMC supports multiple transaction types:

• **Transfer**: Send HSMC between accounts
• **Contract Call**: Interact with smart contracts
• **Contract Deploy**: Deploy new smart contracts
• **Stake**: Delegate tokens to validators
• **Governance**: Vote on protocol proposals`,
      },
      {
        title: 'Transaction Lifecycle',
        content: `1. **Creation**: User creates and signs transaction
2. **Propagation**: Transaction broadcast to network
3. **Mempool**: Validators collect pending transactions
4. **Inclusion**: Transaction included in a block
5. **Finality**: Block receives sufficient confirmations`,
      },
      {
        title: 'Gas & Fees',
        content: `Transaction fees are calculated as:

\`\`\`
fee = gasUsed × gasPrice

Where:
- gasUsed: Computational units consumed
- gasPrice: Price per gas unit (in HSMC)
\`\`\`

Dynamic fee adjustment ensures network stability during high demand.`,
        hasCode: true,
      },
    ],
  },
  {
    id: 'api',
    title: 'API Reference',
    icon: Cpu,
    content: [
      {
        title: 'JSON-RPC API',
        content: `Connect to HSMC using JSON-RPC:

\`\`\`bash
# Get current block number
curl -X POST https://rpc.hsmc.io \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"hsmc_blockNumber","id":1}'
\`\`\`

Available endpoints:
• Mainnet: https://rpc.hsmc.io
• Testnet: https://testnet-rpc.hsmc.io`,
        hasCode: true,
      },
      {
        title: 'WebSocket API',
        content: `Subscribe to real-time updates:

\`\`\`javascript
const ws = new WebSocket('wss://ws.hsmc.io');

ws.send(JSON.stringify({
  jsonrpc: '2.0',
  method: 'hsmc_subscribe',
  params: ['newBlocks'],
  id: 1
}));
\`\`\``,
        hasCode: true,
      },
      {
        title: 'SDK',
        content: `Install the official SDK:

\`\`\`bash
npm install @hsmc/sdk
\`\`\`

\`\`\`typescript
import { HSMC } from '@hsmc/sdk';

const client = new HSMC({
  network: 'mainnet',
  provider: 'https://rpc.hsmc.io'
});

const balance = await client.getBalance(address);
\`\`\``,
        hasCode: true,
      },
    ],
  },
  {
    id: 'cli',
    title: 'CLI Reference',
    icon: Terminal,
    content: [
      {
        title: 'Installation',
        content: `Install the HSMC CLI:

\`\`\`bash
# macOS / Linux
curl -sSL https://install.hsmc.io | bash

# Windows (PowerShell)
iwr https://install.hsmc.io/win | iex

# Verify installation
hsmc --version
\`\`\``,
        hasCode: true,
      },
      {
        title: 'Common Commands',
        content: `\`\`\`bash
# Check network status
hsmc status

# Get account balance
hsmc balance <address>

# Send transaction
hsmc send --to <address> --amount 10

# Deploy contract
hsmc deploy --contract ./MyContract.sol

# Start local node
hsmc node start --dev
\`\`\``,
        hasCode: true,
      },
    ],
  },
  {
    id: 'hsmcpay',
    title: 'HSMCPay Integration',
    icon: Cpu,
    content: [
      {
        title: 'Overview',
        content: `HSMCPay este procesorul de plăți nativ al rețelei HSMC. Permite comercianților să accepte plăți în HSMC direct, fără intermediari.

Funcționalități cheie:
• **3D Secure OTP** — Cod de 6 cifre generat server-side, valabil 5 minute
• **Biometric Auth** — WebAuthn (Face ID, Fingerprint, Windows Hello)
• **Payment Links** — URL-uri partajabile cu sumă predefinită
• **QR Codes** — Coduri QR generate din adresa wallet-ului
• **Real-time Notifications** — Webhook & WebSocket Realtime pentru confirmări instant
• **Luhn Validation** — Validarea algoritmică a numărului de card`,
      },
      {
        title: 'Payment Flow',
        content: `Fluxul de plată HSMCPay:

\`\`\`
1. Cliente → POST /hsmcpay-checkout { action: "initiate", amount_usd, card_* }
   ↓ Validare Luhn + verificare expiry
   ↓ Calcul HSMC = amount_usd / hsmc_price
   ↓ Generare OTP (6 cifre, SHA-256 random)
   ↓ Persistare sesiune în DB (payment_sessions)
   ↓ Trimitere OTP prin notifications

2. Cliente → POST /hsmcpay-checkout { action: "verify", session_id, otp_code }
   ↓ Verificare OTP din DB (nu in-memory!)
   ↓ Verificare expiry (5 min)
   ↓ UPDATE wallets SET balance += amount_hsmc
   ↓ INSERT transactions (confirmed)
   ↓ Notificare confirmare
   ← { success, tx_hash, amount_hsmc, new_balance }
\`\`\``,
        hasCode: true,
      },
      {
        title: 'Merchant API',
        content: `Crearea unui payment link programatic:

\`\`\`typescript
// Creează un link de plată
const { data } = await supabase
  .from('payment_links')
  .insert({
    user_id: merchantId,
    wallet_address: '0x...',
    amount: 50.00,          // null = sumă liberă
    token: 'HSMC',
    description: 'Invoice #1234',
  })
  .select()
  .single();

const paymentUrl = \`https://hsmc.io/pay/\${data.slug}\`;

// Monitorizare plăți în timp real
supabase
  .channel('merchant-payments')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'payment_links',
    filter: \`id=eq.\${data.id}\`,
  }, (payload) => {
    console.log('New payment!', payload.new.payments_count);
  })
  .subscribe();
\`\`\``,
        hasCode: true,
      },
      {
        title: 'Webhook Events',
        content: `HSMCPay emite evenimente în timp real prin WebSocket Realtime:

**payment_otp** — Cod 3DS generat
**payment_completed** — Plată finalizată, HSMC creditat
**payment_expired** — Sesiunea OTP a expirat

\`\`\`typescript
// Payload pentru payment_completed:
{
  payment_id: string,
  amount_hsmc: number,   // HSMC creditat
  amount_usd: number,    // USD debitat
  card_brand: 'Visa' | 'Mastercard' | 'Amex',
  card_last4: string,
  tx_hash: string        // Hash tranzacție on-chain
}
\`\`\``,
        hasCode: true,
      },
    ],
  },
];

const CodeBlock = ({ code }: { code: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const cleanCode = code.replace(/```\w*\n?/g, '').trim();
    navigator.clipboard.writeText(cleanCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeContent = code.replace(/```\w*\n?/g, '').trim();
  const language = code.match(/```(\w+)/)?.[1] || 'text';

  return (
    <div className="relative group mt-4">
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-muted-foreground">{language}</span>
        <button
          onClick={handleCopy}
          className="p-1.5 rounded bg-muted/50 hover:bg-muted transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-secondary" />
          ) : (
            <Copy className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </div>
      <pre className="terminal rounded-lg p-4 overflow-x-auto text-sm">
        <code>{codeContent}</code>
      </pre>
    </div>
  );
};

export const Documentation = () => {
  const [activeSection, setActiveSection] = useState('core');
  const [expandedItems, setExpandedItems] = useState<string[]>(['Overview']);
  const [searchQuery, setSearchQuery] = useState('');

  const currentSection = docSections.find((s) => s.id === activeSection);

  const toggleItem = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const filteredContent = currentSection?.content.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <section id="docs" className="py-20">
      <div className="container mx-auto px-4">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            <span className="gradient-text">Documentation</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Everything you need to build on HSMC HSMC
          </p>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="lg:w-64 flex-shrink-0"
          >
            <div className="glass-panel sticky top-24">
              {/* Search */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 mb-4">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search docs..."
                  className="flex-1 bg-transparent outline-none text-sm"
                />
              </div>

              {/* Navigation */}
              <nav className="space-y-1">
                {docSections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
                      activeSection === section.id
                        ? 'bg-primary/20 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    <section.icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{section.title}</span>
                  </button>
                ))}
              </nav>

              {/* External Links */}
              <div className="mt-6 pt-6 border-t border-border">
                <a
                  href="#"
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                  Full Documentation
                  <ExternalLink className="w-3 h-3 ml-auto" />
                </a>
              </div>
            </div>
          </motion.aside>

          {/* Content */}
          <motion.main
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex-1 min-w-0"
          >
            <div className="glass-panel">
              {currentSection && (
                <>
                  <div className="flex items-center gap-3 mb-6 pb-6 border-b border-border">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <currentSection.icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-xl font-semibold">{currentSection.title}</h3>
                  </div>

                  <div className="space-y-4">
                    <AnimatePresence mode="wait">
                      {filteredContent?.map((item, index) => (
                        <motion.div
                          key={item.title}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ delay: index * 0.05 }}
                          className="border border-border rounded-lg overflow-hidden"
                        >
                          <button
                            onClick={() => toggleItem(item.title)}
                            className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                          >
                            <span className="font-medium">{item.title}</span>
                            <ChevronRight
                              className={`w-4 h-4 transition-transform ${
                                expandedItems.includes(item.title) ? 'rotate-90' : ''
                              }`}
                            />
                          </button>

                          <AnimatePresence>
                            {expandedItems.includes(item.title) && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="border-t border-border"
                              >
                                <div className="p-4">
                                  {item.hasCode ? (
                                    <>
                                      {item.content.split('```').map((part, i) => {
                                        if (i % 2 === 0) {
                                          return (
                                            <p
                                              key={i}
                                              className="text-muted-foreground whitespace-pre-wrap"
                                            >
                                              {part}
                                            </p>
                                          );
                                        }
                                        return <CodeBlock key={i} code={'```' + part + '```'} />;
                                      })}
                                    </>
                                  ) : (
                                    <div className="prose prose-invert max-w-none">
                                      {item.content.split('\n\n').map((paragraph, i) => (
                                        <p
                                          key={i}
                                          className="text-muted-foreground mb-3 last:mb-0 whitespace-pre-wrap"
                                        >
                                          {paragraph}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {filteredContent?.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        No results found for "{searchQuery}"
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.main>
        </div>
      </div>
    </section>
  );
};

export default Documentation;
