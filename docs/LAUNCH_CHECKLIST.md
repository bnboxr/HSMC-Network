# HSMC Mainnet — Launch Checklist

**Version:** 1.0  
**Chain ID:** `hsmc-mainnet-1`  
**Last Updated:** 2026-07-26  

---

## Phase 1: Pre-Launch (4–8 Weeks Before)

### 1.1 Security & Audit
- [ ] **RingCT cryptographic audit** — Third-party review of `ringct.rs`, `ring_sig.rs`, `stealth.rs` (Trail of Bits / Least Authority / Certik)
- [ ] **CLSAG ring signature audit** — Verify linkability, unforgeability, anonymity set correctness
- [ ] **Bulletproofs range proof audit** — Verify soundness, zero-knowledge property, no value leakage
- [ ] **Stealth address audit** — ECDH derivation, one-time key correctness, no replay vulnerabilities
- [ ] **PoW audit** — RandomX implementation correctness, difficulty retargeting, no time-warp attacks
- [ ] **P2P network audit** — Eclipse attack resistance, Dandelion++ stem/fluff correctness, DoS resistance
- [ ] **RPC security audit** — Input validation, rate limiting, auth bypass, sensitive data exposure
- [ ] **Bridge contract audit** (`WHSMC.sol`, `BridgeMinter.sol`) — Reentrancy, overflow, access control, fraud proof logic
- [ ] **Web wallet audit** — XSS, CSRF, seed phrase handling, WebCrypto key management
- [ ] **Penetration test** — Full stack: Rust node, RPC API, Stratum server, bridge relayer, web wallet
- [ ] **Bug bounty program** — Set up on Immunefi / HackerOne, define scope & rewards (minimum 30 days before launch)
- [ ] **HIBP password check** — Enable in Supabase auth config (`password_hibp_enabled: true`)
- [ ] **DB security strict mode** — Set `DB_SECURITY_STRICT=true` for production
- [ ] **SQL injection audit** — Verify all queries are parameterized (last audit: 0 vulns, 2026-07-25)

### 1.2 Testnet Validation
- [ ] **Testnet running for ≥ 4 weeks** — Minimum uptime 95%, with real external miners
- [ ] **Block production stable** — Consistent 120s target block time, no chain halts > 1 hour
- [ ] **Difficulty retargeting validated** — Verify DDA over at least 3 full windows (6048+ blocks)
- [ ] **Mempool stress test** — 10,000+ pending transactions, verify TX propagation and ordering
- [ ] **Bridge testnet deployment** — Full lock/mint/burn/unlock cycle on BSC testnet, ETH Sepolia, Polygon Amoy
- [ ] **Stratum mining testnet** — ≥ 3 external miners connected via Stratum V1, shares validated
- [ ] **Governance test** — Create proposal → vote → pass → execute lifecycle (full cycle)
- [ ] **Staking test** — Stake → rewards → unbond → claim lifecycle
- [ ] **HSMCPay testnet** — Stripe integration, real card test transactions, OTP flow
- [ ] **Wallet test** — Multi-device wallet create/restore, internal transfers, privacy mode switching
- [ ] **Fork handling test** — Simulate chain split, verify heaviest-chain selection and reorg
- [ ] **Network partition test** — Isolate nodes, verify reconnection and state sync

### 1.3 Infrastructure
- [ ] **Provision 5 seed nodes** — Minimum spec: 4 vCPU, 8 GB RAM, 200 GB SSD NVMe
  - [ ] EU-West (Frankfurt/Amsterdam) — Hetzner CX42 or equivalent
  - [ ] EU-Central (Frankfurt) — Hetzner CX42 or equivalent
  - [ ] US-East (New York/Ashburn) — Vultr/DigitalOcean
  - [ ] US-West (San Francisco) — Vultr/AWS
  - [ ] APAC (Singapore) — OVH/Vultr
- [ ] **Provision 3 bridge relayers** — Minimum spec: 2 vCPU, 4 GB RAM
- [ ] **DNS configured** — `seed-1.hsmc.network` through `seed-5.hsmc.network`
- [ ] **TLS certificates** — Let's Encrypt wildcard cert for `*.hsmc.network`
- [ ] **Monitoring stack** — Prometheus + Grafana dashboard for all seed nodes
- [ ] **Alerting configured** — PagerDuty / OpsGenie for node downtime, chain halt, low peer count
- [ ] **Backup strategy** — Daily RocksDB snapshots, off-site backup rotation
- [ ] **DDoS protection** — Cloudflare proxy for public RPC endpoints, rate limiting
- [ ] **Firewall rules** — Ports 8080 (RPC), 30303 (P2P), 3333 (Stratum) open; all others blocked

### 1.4 Community & Marketing
- [ ] **Website live** — `https://hsmc.network` with explorer, docs, whitepaper
- [ ] **Explorer functional** — `/explorer` route, live blocks, transactions, stats
- [ ] **Whitepaper published** — PDF on website + IPFS + arXiv
- [ ] **Documentation complete** — API docs, node operator guide, mining guide, wallet guide
- [ ] **Social media active** — Twitter/X, Discord, Telegram, Reddit (r/hsmc, r/cryptocurrency)
- [ ] **Community channels** — Discord with #announcements, #mining, #development, #support
- [ ] **Press kit ready** — Logos, brand assets, one-pager, team bios
- [ ] **Announcement drafted** — Mainnet launch blog post, tweet thread, Discord announcement
- [ ] **Influencer outreach** — 5–10 crypto content creators briefed for launch day coverage

### 1.5 Legal & Compliance
- [ ] **Legal opinion obtained** — "Not a security" opinion from crypto-specialized law firm
- [ ] **Jurisdiction selected** — Foundation/DAO entity in favorable jurisdiction (Estonia, BVI, Cayman, Switzerland)
- [ ] **Terms of Service** — Published on website
- [ ] **Privacy Policy** — Published on website
- [ ] **KYC/AML policy** — Defined for fiat on/off ramps
- [ ] **Token classification memo** — Internal memo on Howey test analysis

---

## Phase 2: Launch Day

### 2.1 Pre-Launch (T-24 hours)
- [ ] **Final code freeze** — Tag release `v1.0.0-mainnet` on GitHub
- [ ] **Binary release published** — GitHub Releases with checksums
- [ ] **Docker image pushed** — Docker Hub / GHCR
- [ ] **All seed nodes updated** — Pull latest binary, verify checksum
- [ ] **Genesis block committed** — `genesis.toml` verified across all seed nodes
- [ ] **Seed node identity keys generated** — All 5 `identity.key` files created
- [ ] **Bootstrap peer list finalized** — Multiaddr list in `genesis.toml`
- [ ] **Monitoring dashboards verified** — All metrics endpoints responding
- [ ] **Alerting test** — Trigger test alert, verify delivery to all channels
- [ ] **War room open** — Dedicated voice channel for core team during launch
- [ ] **Launch script tested** — Dry-run the launch sequence on staging

### 2.2 Genesis (T-0)
- [ ] **Announcement published** — Website, Twitter, Discord, Telegram, Reddit
- [ ] **Seed node 1 started** — First node mints genesis block (block #0)
- [ ] **Verify genesis block** — Check `curl http://seed-1.hsmc.network:8080/block/0`
- [ ] **Seed nodes 2–5 started** — Within 5 minutes of node 1
- [ ] **Verify peer discovery** — All 5 nodes discover each other within 2 minutes
- [ ] **Verify block propagation** — Block #1 mined and propagated to all nodes within 5 minutes
- [ ] **Verify consensus** — All nodes agree on chain tip hash
- [ ] **Initial difficulty set** — 256 (minimum), will auto-adjust

### 2.3 Post-Genesis Monitoring (T+0 to T+24 hours)
- [ ] **Block production rate** — Verify ~30 blocks/hour (120s target)
- [ ] **No chain forks** — All nodes on same chain tip
- [ ] **Peer count stable** — ≥ 4 peers per node
- [ ] **Mempool healthy** — Transactions being accepted and propagated
- [ ] **RPC responsive** — All endpoints < 500ms p95 latency
- [ ] **Stratum accepting connections** — Miners can connect and submit shares
- [ ] **Bridge operational** — Lock/unlock tested on all target chains
- [ ] **HSMCPay operational** — Test payment through Stripe
- [ ] **Explorer updating** — New blocks visible within 10 seconds
- [ ] **No alerts triggered** — Zero critical/warning alerts
- [ ] **Hashrate reporting** — Hashrate visible in `/mining/info`
- [ ] **Community engagement** — Respond to all questions in Discord/Telegram within 15 minutes

### 2.4 Contingency Plans
- [ ] **Chain halt procedure** — Documented steps for emergency restart
- [ ] **Rollback procedure** — Documented steps for chain rollback (governance vote)
- [ ] **Seed node replacement** — Documented steps for replacing a failed seed node
- [ ] **DDoS mitigation** — Cloudflare rules, rate limiting thresholds
- [ ] **Emergency contacts** — All team members, hosting providers, DNS provider

---

## Phase 3: Post-Launch (First 30 Days)

### 3.1 Stability & Operations
- [ ] **30-day uptime ≥ 99.5%** — Tracked via Prometheus/Grafana
- [ ] **Zero chain halts** — No block production gaps > 10 minutes
- [ ] **Weekly security scan** — Dependency audit, vulnerability scan
- [ ] **Performance tuning** — RocksDB compaction, memory usage, P2P peer selection
- [ ] **Log analysis** — Review WARN/ERROR logs weekly, fix root causes
- [ ] **Backup verification** — Restore from backup monthly, verify integrity

### 3.2 Exchange Listings
- [ ] **CoinMarketCap listing submitted** — `listings/coinmarketcap.json`
- [ ] **CoinGecko listing submitted** — `listings/coingecko.json`
- [ ] **MEXC Innovation Zone application** — Submit via MEXC listing form
- [ ] **Gate.io Startup application** — Submit via Gate.io listing form
- [ ] **DEX liquidity pools** — PancakeSwap (BSC), Uniswap (ETH), QuickSwap (Polygon)
  - [ ] Initial liquidity: $50,000+ per pool
  - [ ] Liquidity locked for minimum 12 months (UniCrypt / PinkSale)
- [ ] **Market maker engagement** — Engage professional market maker for order book depth
- [ ] **Exchange listing package ready** — `docs/exchange-listing/` (project overview, token details, security review)

### 3.3 Community Growth
- [ ] **Twitter/X followers** — Target: 5,000+ in first 30 days
- [ ] **Discord members** — Target: 2,000+ in first 30 days
- [ ] **Telegram members** — Target: 3,000+ in first 30 days
- [ ] **Active miners** — Target: 10+ unique miner addresses in first 30 days
- [ ] **Weekly community call** — AMA/update every Friday
- [ ] **Developer onboarding** — Tutorial series, SDK docs, example dApps
- [ ] **Mining pool partnerships** — At least 1 mining pool supporting HSMC

### 3.4 Development
- [ ] **Bug bounty payouts** — Process and pay all valid reports within 7 days
- [ ] **Security patches** — Zero-day vulnerabilities patched within 24 hours
- [ ] **Feature roadmap published** — 6-month and 12-month roadmap
- [ ] **v1.1 planning** — Governance timelock, WebAuthn, Stratum V2 Noise handshake
- [ ] **Bridge chain expansion** — Deploy to remaining 7 chains (from 3 to 10)
- [ ] **Privacy UX improvements** — Wire RingCT + stealth into web wallet end-to-end

### 3.5 Governance Activation
- [ ] **First governance proposal** — Bootstrap parameter tuning (if needed)
- [ ] **Treasury establishment** — Multi-sig treasury wallet (3-of-5 by core team)
- [ ] **Grant program draft** — Community development fund proposal

---

## Phase 4: Growth (30–90 Days)

### 4.1 Ecosystem
- [ ] **dApp incubator program** — Grants for first 5 dApps on HSMC
- [ ] **Wallet partnerships** — Integration with at least 2 third-party wallets (MetaMask Snap, Trust Wallet, etc.)
- [ ] **Explorer enhancements** — Rich transaction details, address pages, charts/analytics
- [ ] **Mobile wallet** — iOS and Android wallet app
- [ ] **Hardware wallet support** — Ledger / Trezor integration

### 4.2 Liquidity & Markets
- [ ] **CEX listing confirmed** — At least 1 tier-2 CEX (MEXC, Gate.io, KuCoin)
- [ ] **DEX volume ≥ $100k daily** — Across all chains
- [ ] **CMC/CG rank improvement** — Target: Top 500 within 90 days
- [ ] **Treasury buyback program** — First buyback & burn event

### 4.3 Technical Milestones
- [ ] **Post-quantum readiness** — Kyber-1024, Dilithium-5 integration (per whitepaper)
- [ ] **Smart contract VM** — WASM-based VM for on-chain programmability
- [ ] **Stratum V2 full** — Noise/AEAD encryption, sub-protocols
- [ ] **Decentralized bridge** — MPC/threshold relayer (remove single-signer)

---

## Emergency Contacts

| Role | Name | Signal/Telegram | Email |
|------|------|-----------------|-------|
| Lead Engineer | — | — | — |
| Infrastructure | — | — | — |
| Security | — | — | — |
| Community | — | — | — |
| Legal | — | — | — |

---

## Key Links

| Resource | URL |
|----------|-----|
| Website | https://hsmc.network |
| Explorer | https://hsmc.network/explorer |
| GitHub | https://github.com/bnboxr/HSMC-Network |
| Whitepaper | https://hsmc.network/whitepaper |
| Discord | — |
| Twitter/X | — |
| Telegram | — |

---

> **Status at 2026-07-26:** Pre-launch. Audit and testnet milestones in progress.  
> **Target mainnet launch:** TBD — pending audit completion and testnet validation.
