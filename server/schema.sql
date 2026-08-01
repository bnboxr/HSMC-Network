PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT, balance REAL, created_at TEXT, id TEXT PRIMARY KEY, is_primary INTEGER,
  label TEXT, staked_balance REAL, updated_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS wallet_seeds (
  created_at TEXT, encrypted_seed TEXT, id TEXT PRIMARY KEY, updated_at TEXT, user_id TEXT,
  wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  amount REAL, block_number REAL, commitment TEXT, confirmed_at TEXT, created_at TEXT,
  decoy_count REAL, fee REAL, from_address TEXT, hash TEXT, id TEXT PRIMARY KEY,
  privacy_level TEXT, range_proof TEXT, ring_signature TEXT, status TEXT, stealth_address TEXT,
  to_address TEXT
);

CREATE TABLE IF NOT EXISTS blocks (
  block_number REAL, created_at TEXT, difficulty REAL, hash TEXT, id TEXT PRIMARY KEY,
  miner_address TEXT, nonce REAL, prev_hash TEXT, privacy_protocol TEXT, transactions_count REAL
);

CREATE TABLE IF NOT EXISTS treasury_transactions (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  amount_usd REAL NOT NULL,
  fee_hsmc REAL NOT NULL,
  fee_tier TEXT NOT NULL,
  payment_intent_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tx_hash TEXT,
  type TEXT CHECK(type IN ('buy_fee', 'sell_fee', 'buyback', 'staking_reward', 'dev_fund', 'insurance')) DEFAULT 'buy_fee',
  status TEXT CHECK(status IN ('pending', 'settled', 'failed')) DEFAULT 'settled',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  device_name TEXT
);

CREATE TABLE IF NOT EXISTS totp_secrets (
  backup_codes TEXT, created_at TEXT, enabled INTEGER, id TEXT PRIMARY KEY, secret TEXT,
  updated_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS governance_proposals (
  created_at TEXT, description TEXT, ends_at TEXT, id TEXT PRIMARY KEY, parameter_key TEXT,
  parameter_value TEXT, proposal_type TEXT, proposer_address TEXT, quorum_required REAL,
  status TEXT, title TEXT, user_id TEXT, votes_against REAL, votes_for REAL
);

CREATE TABLE IF NOT EXISTS governance_votes (
  created_at TEXT, id TEXT PRIMARY KEY, proposal_id TEXT, user_id TEXT, vote_choice TEXT,
  vote_weight REAL, voter_address TEXT
);

CREATE TABLE IF NOT EXISTS staking_pools (
  apr REAL, commission_rate REAL, created_at TEXT, id TEXT PRIMARY KEY, min_stake REAL,
  name TEXT, status TEXT, total_staked REAL, validator_address TEXT
);

CREATE TABLE IF NOT EXISTS stakes (
  amount REAL, id TEXT PRIMARY KEY, last_reward_at TEXT, pool_id TEXT, rewards_claimed REAL,
  rewards_earned REAL, staked_at TEXT, status TEXT, unstake_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS liquidity_pools (
  chain_name TEXT, created_at TEXT, dex_name TEXT, fee_bps REAL, id TEXT PRIMARY KEY,
  pair_token TEXT, pool_address TEXT, pool_type TEXT, reserve_hsmc REAL, reserve_pair REAL,
  status TEXT, total_lp_tokens REAL, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS lp_positions (
  created_at TEXT, fees_earned REAL, hsmc_deposited REAL, id TEXT PRIMARY KEY, lp_tokens REAL,
  pair_deposited REAL, pool_id TEXT, updated_at TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS pool_events (
  created_at TEXT, event_type TEXT, hsmc_delta REAL, id TEXT PRIMARY KEY, pair_delta REAL,
  payment_ref TEXT, pool_id TEXT, price_after REAL, tx_hash TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS swap_rates (
  from_token TEXT, id TEXT PRIMARY KEY, rate REAL, to_token TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS token_swaps (
  created_at TEXT, from_amount REAL, from_token TEXT, id TEXT PRIMARY KEY, privacy_level TEXT,
  rate REAL, slippage REAL, status TEXT, to_amount REAL, to_token TEXT, tx_hash TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_sessions (
  amount_hsmc REAL, amount_usd REAL, card_brand TEXT, card_holder TEXT, card_last4 TEXT,
  created_at TEXT, id TEXT PRIMARY KEY, otp_attempts REAL, otp_code TEXT, otp_expires_at TEXT,
  processor TEXT, session_id TEXT, settlement_tx_hash TEXT, status TEXT,
  stripe_client_secret TEXT, stripe_payment_intent_id TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_links (
  active INTEGER, amount REAL, created_at TEXT, description TEXT, id TEXT PRIMARY KEY,
  payments_count REAL, slug TEXT, token TEXT, total_received REAL, user_id TEXT, wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS smart_contracts (
  abi TEXT, address TEXT, bytecode TEXT, contract_type TEXT, created_at TEXT, deployed_at TEXT,
  deployer_address TEXT, id TEXT PRIMARY KEY, interactions_count REAL, name TEXT,
  source_code TEXT, status TEXT, user_id TEXT, version TEXT
);

CREATE TABLE IF NOT EXISTS contract_interactions (
  caller_address TEXT, contract_id TEXT, created_at TEXT, function_name TEXT, gas_used REAL,
  id TEXT PRIMARY KEY, inputs TEXT, outputs TEXT, status TEXT, tx_hash TEXT
);

CREATE TABLE IF NOT EXISTS network_peers (
  created_at TEXT, id TEXT PRIMARY KEY, ip_address TEXT, last_seen_at TEXT, latency REAL,
  peer_id TEXT, port REAL, region TEXT, status TEXT, version TEXT
);

CREATE TABLE IF NOT EXISTS network_stats (
  active_nodes REAL, block_height REAL, consensus_state TEXT, hash_rate TEXT, id TEXT PRIMARY KEY,
  latency REAL, network_difficulty REAL, total_transactions REAL, tps REAL, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  created_at TEXT, data TEXT, id TEXT PRIMARY KEY, message TEXT, read INTEGER, title TEXT,
  type TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  created_at TEXT, email TEXT, id TEXT PRIMARY KEY, source TEXT
);

CREATE TABLE IF NOT EXISTS platform_config (
  hsmcpay_intermediary_enabled INTEGER, kill_switch_active INTEGER DEFAULT 0,
  id REAL PRIMARY KEY, updated_at TEXT, updated_by TEXT
);

CREATE TABLE IF NOT EXISTS platform_stats (
  countries_count REAL, developers_count REAL, id TEXT PRIMARY KEY, tvl REAL, updated_at TEXT,
  uptime_percent REAL
);

CREATE TABLE IF NOT EXISTS token_metrics (
  all_time_high REAL, all_time_high_date TEXT, circulating_supply REAL,
  fully_diluted_valuation REAL, id TEXT PRIMARY KEY, market_cap REAL, market_cap_change_24h REAL,
  price REAL, price_change_24h REAL, staked_supply REAL, token_holders REAL, total_supply REAL,
  updated_at TEXT, volume_24h REAL, volume_change_24h REAL, ytd_return REAL
);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY, price REAL, timestamp TEXT, volume REAL
);

CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT, created_at TEXT, id TEXT PRIMARY KEY, user_id TEXT
);

CREATE TABLE IF NOT EXISTS referral_uses (
  bonus_amount REAL, bonus_paid INTEGER, created_at TEXT, id TEXT PRIMARY KEY,
  referral_code_id TEXT, referred_user_id TEXT, referrer_user_id TEXT
);

CREATE TABLE IF NOT EXISTS internal_transfers (
  amount REAL, created_at TEXT, from_wallet_id TEXT, id TEXT PRIMARY KEY, note TEXT,
  to_wallet_id TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS deployment_status (
  contract_address TEXT, created_at TEXT, created_by TEXT, explorer_url TEXT, id TEXT PRIMARY KEY,
  network TEXT, notes TEXT, pair_address TEXT, status TEXT, step_id TEXT, tx_hash TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  created_at TEXT, id TEXT PRIMARY KEY, role TEXT, user_id TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  avatar_url TEXT, created_at TEXT, id TEXT PRIMARY KEY, updated_at TEXT, user_id TEXT,
  username TEXT, wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  created_at TEXT, id TEXT PRIMARY KEY, setting_key TEXT, setting_value TEXT, updated_at TEXT,
  user_id TEXT
);

-- Additional tables from schema not in the ordered list

CREATE TABLE IF NOT EXISTS settings_schema (
  category TEXT, description TEXT, display_order REAL, example_value TEXT, is_secret INTEGER,
  key TEXT, label TEXT, required_for TEXT, validation_regex TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, admin_user TEXT, action TEXT,
  details TEXT, ip_address TEXT, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_sessions_safe (
  amount_hsmc REAL, amount_usd REAL, card_brand TEXT, card_last4 TEXT, created_at TEXT,
  id TEXT PRIMARY KEY, otp_expires_at TEXT, session_id TEXT, status TEXT, user_id TEXT
);
