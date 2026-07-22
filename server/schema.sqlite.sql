-- HSMC Own Database Schema
-- Generated from Supabase types
-- 2026-07-21T18:53:02.000Z

PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS blocks (
  block_number REAL,
  created_at TEXT,
  difficulty REAL,
  hash TEXT,
  id TEXT,
  miner_address TEXT,
  nonce REAL,
  prev_hash TEXT,
  privacy_protocol TEXT,
  transactions_count REAL
);

CREATE TABLE IF NOT EXISTS contract_interactions (
  caller_address TEXT,
  contract_id TEXT,
  created_at TEXT,
  function_name TEXT,
  gas_used REAL,
  id TEXT,
  inputs TEXT,
  outputs TEXT,
  status TEXT,
  tx_hash TEXT
);

CREATE TABLE IF NOT EXISTS deployment_status (
  contract_address TEXT,
  created_at TEXT,
  created_by TEXT,
  explorer_url TEXT,
  id TEXT,
  network TEXT,
  notes TEXT,
  pair_address TEXT,
  status TEXT,
  step_id TEXT,
  tx_hash TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS governance_proposals (
  created_at TEXT,
  description TEXT,
  ends_at TEXT,
  id TEXT,
  parameter_key TEXT,
  parameter_value TEXT,
  proposal_type TEXT,
  proposer_address TEXT,
  quorum_required REAL,
  status TEXT,
  title TEXT,
  user_id TEXT,
  votes_against REAL,
  votes_for REAL
);

CREATE TABLE IF NOT EXISTS governance_votes (
  created_at TEXT,
  id TEXT,
  proposal_id TEXT,
  user_id TEXT,
  vote_choice TEXT,
  vote_weight REAL,
  voter_address TEXT
);

CREATE TABLE IF NOT EXISTS internal_transfers (
  amount REAL,
  created_at TEXT,
  from_wallet_id TEXT,
  id TEXT,
  note TEXT,
  to_wallet_id TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS liquidity_pools (
  chain_name TEXT,
  created_at TEXT,
  dex_name TEXT,
  fee_bps REAL,
  id TEXT,
  pair_token TEXT,
  pool_address TEXT,
  pool_type TEXT,
  reserve_hsmc REAL,
  reserve_pair REAL,
  status TEXT,
  total_lp_tokens REAL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS lp_positions (
  created_at TEXT,
  fees_earned REAL,
  hsmc_deposited REAL,
  id TEXT,
  lp_tokens REAL,
  pair_deposited REAL,
  pool_id TEXT,
  updated_at TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS network_peers (
  created_at TEXT,
  id TEXT,
  ip_address TEXT,
  last_seen_at TEXT,
  latency REAL,
  peer_id TEXT,
  port REAL,
  region TEXT,
  status TEXT,
  version TEXT
);

CREATE TABLE IF NOT EXISTS network_stats (
  active_nodes REAL,
  block_height REAL,
  consensus_state TEXT,
  hash_rate TEXT,
  id TEXT,
  latency REAL,
  network_difficulty REAL,
  total_transactions REAL,
  tps REAL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  created_at TEXT,
  email TEXT,
  id TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  created_at TEXT,
  data TEXT,
  id TEXT,
  message TEXT,
  read INTEGER,
  title TEXT,
  type TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_links (
  active INTEGER,
  amount REAL,
  created_at TEXT,
  description TEXT,
  id TEXT,
  payments_count REAL,
  slug TEXT,
  token TEXT,
  total_received REAL,
  user_id TEXT,
  wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS payment_sessions (
  amount_hsmc REAL,
  amount_usd REAL,
  card_brand TEXT,
  card_holder TEXT,
  card_last4 TEXT,
  created_at TEXT,
  id TEXT,
  otp_attempts REAL,
  otp_code TEXT,
  otp_expires_at TEXT,
  processor TEXT,
  session_id TEXT,
  settlement_tx_hash TEXT,
  status TEXT,
  stripe_client_secret TEXT,
  stripe_payment_intent_id TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS platform_config (
  hsmcpay_intermediary_enabled INTEGER,
  id REAL,
  updated_at TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS platform_stats (
  countries_count REAL,
  developers_count REAL,
  id TEXT,
  tvl REAL,
  updated_at TEXT,
  uptime_percent REAL
);

CREATE TABLE IF NOT EXISTS pool_events (
  created_at TEXT,
  event_type TEXT,
  hsmc_delta REAL,
  id TEXT,
  pair_delta REAL,
  payment_ref TEXT,
  pool_id TEXT,
  price_after REAL,
  tx_hash TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT,
  price REAL,
  timestamp TEXT,
  volume REAL
);

CREATE TABLE IF NOT EXISTS profiles (
  avatar_url TEXT,
  created_at TEXT,
  id TEXT,
  updated_at TEXT,
  user_id TEXT,
  username TEXT,
  wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT,
  created_at TEXT,
  id TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS referral_uses (
  bonus_amount REAL,
  bonus_paid INTEGER,
  created_at TEXT,
  id TEXT,
  referral_code_id TEXT,
  referred_user_id TEXT,
  referrer_user_id TEXT
);

CREATE TABLE IF NOT EXISTS settings_schema (
  category TEXT,
  description TEXT,
  display_order REAL,
  example_value TEXT,
  is_secret INTEGER,
  key TEXT,
  label TEXT,
  required_for TEXT,
  validation_regex TEXT
);

CREATE TABLE IF NOT EXISTS smart_contracts (
  abi TEXT,
  address TEXT,
  bytecode TEXT,
  contract_type TEXT,
  created_at TEXT,
  deployed_at TEXT,
  deployer_address TEXT,
  id TEXT,
  interactions_count REAL,
  name TEXT,
  source_code TEXT,
  status TEXT,
  user_id TEXT,
  version TEXT
);

CREATE TABLE IF NOT EXISTS stakes (
  amount REAL,
  id TEXT,
  last_reward_at TEXT,
  pool_id TEXT,
  rewards_claimed REAL,
  rewards_earned REAL,
  staked_at TEXT,
  status TEXT,
  unstake_at TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS staking_pools (
  apr REAL,
  commission_rate REAL,
  created_at TEXT,
  id TEXT,
  min_stake REAL,
  name TEXT,
  status TEXT,
  total_staked REAL,
  validator_address TEXT
);

CREATE TABLE IF NOT EXISTS swap_rates (
  from_token TEXT,
  id TEXT,
  rate REAL,
  to_token TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS token_metrics (
  all_time_high REAL,
  all_time_high_date TEXT,
  circulating_supply REAL,
  fully_diluted_valuation REAL,
  id TEXT,
  market_cap REAL,
  market_cap_change_24h REAL,
  price REAL,
  price_change_24h REAL,
  staked_supply REAL,
  token_holders REAL,
  total_supply REAL,
  updated_at TEXT,
  volume_24h REAL,
  volume_change_24h REAL,
  ytd_return REAL
);

CREATE TABLE IF NOT EXISTS token_swaps (
  created_at TEXT,
  from_amount REAL,
  from_token TEXT,
  id TEXT,
  privacy_level TEXT,
  rate REAL,
  slippage REAL,
  status TEXT,
  to_amount REAL,
  to_token TEXT,
  tx_hash TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS totp_secrets (
  backup_codes TEXT,
  created_at TEXT,
  enabled INTEGER,
  id TEXT,
  secret TEXT,
  updated_at TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  amount REAL,
  block_number REAL,
  commitment TEXT,
  confirmed_at TEXT,
  created_at TEXT,
  decoy_count REAL,
  fee REAL,
  from_address TEXT,
  hash TEXT,
  id TEXT,
  privacy_level TEXT,
  range_proof TEXT,
  ring_signature TEXT,
  status TEXT,
  stealth_address TEXT,
  to_address TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  created_at TEXT,
  id TEXT,
  role TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  created_at TEXT,
  id TEXT,
  setting_key TEXT,
  setting_value TEXT,
  updated_at TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS wallet_seeds (
  created_at TEXT,
  encrypted_seed TEXT,
  id TEXT,
  updated_at TEXT,
  user_id TEXT,
  wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT,
  balance REAL,
  created_at TEXT,
  id TEXT,
  is_primary INTEGER,
  label TEXT,
  staked_balance REAL,
  updated_at TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_sessions_safe (
  amount_hsmc REAL,
  amount_usd REAL,
  card_brand TEXT,
  card_last4 TEXT,
  created_at TEXT,
  id TEXT,
  otp_expires_at TEXT,
  session_id TEXT,
  status TEXT,
  user_id TEXT
);

