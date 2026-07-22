# HSMC Supabase — Live Data Extraction

## Summary
- **35 tables** in schema
- **7 tables** with public live data
- **4 tables** require authentication (wallets, stakes, payment_sessions, profiles)

## Data Extracted (2026-07-21)

### blocks (2+ rows)
- Genesis block: block_number=1, miner=0xd07ea42..., difficulty=4000000, privacy_protocol=RingCT-v2
- Block 6 also exists

### transactions (1+ rows)  
- tx 0x845af0d6...: from HSMCPay treasury → 0xd07ea42..., amount=250 HSMC, fee=0.0001, status=confirmed
- Privacy fields: ring_signature, stealth_address, commitment, range_proof all null (not yet active)

### governance_proposals (1 row)
- "APR 20%" — staking appreciation proposal, status=active, 1 vote for, 0 against, quorum=1000

### governance_votes (1 row)
- Vote for proposal above, voter=0xd07ea42..., choice=for

### staking_pools (2 rows)
- Genesis Pool: 12.5% APR, min_stake=100 HSMC, 5% commission
- Beta Validator: 18% APR, min_stake=500 HSMC, 3.5% commission

### token_metrics (2 rows)
- circulating_supply=65,000,000, total_supply=1,000,000,000,000 (1 trillion)
- token_holders=4, price=$0

### price_history (4+ rows)
- Prices ~$0.045, timestamps Mar 2026

### smart_contracts (1 row)
- HSMC Token contract: 0x06e639e88...

## Tables requiring auth (RLS-protected)
- wallets
- stakes  
- payment_sessions
- profiles
- wallet_seeds

## Architecture Decision
For own DB migration:
1. **Keep tables needed by frontend** (from active-tables.md analysis)
2. **Replace Supabase auth** with local seed-phrase auth (already done)
3. **Replace Supabase REST** with local SQLite + API
4. **Migrate existing data** from public tables
5. **Drop** newsletter_subscribers, payment_sessions, and other Stripe-dependent tables (use our own Stripe integration directly)
