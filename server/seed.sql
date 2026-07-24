-- ============================================================================
-- HSMC Network — Seed Data
-- Generated 2026-07-21
-- Realistic test data: 1 wallet, transactions, staking/liquidity pools,
-- governance, token metrics, network stats, platform config.
-- ============================================================================

PRAGMA journal_mode=WAL;

-- ---------------------------------------------------------------------------
-- 1. USER + PROFILE
-- ---------------------------------------------------------------------------
INSERT INTO users (id, email, password_hash, created_at, updated_at)
VALUES ('usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
        'demo@hsmc.network',
        '$2b$12$KZLr7QZ8V3nLmX5PwRtYuOz9NkYqWxVjHdCsFbGaE4Tc6UfAi8Bp',
        '2026-06-21T08:00:00Z',
        '2026-07-21T10:30:00Z');

INSERT INTO profiles (id, user_id, username, wallet_address, avatar_url, created_at, updated_at)
VALUES ('prf_8a4b2c3d5e6f7a8b9c0d1e2f3a4b5c6d',
        'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
        'crypto_demo',
        'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
        'https://avatars.hsmc.network/usr_7f3a9b2c.png',
        '2026-06-21T08:00:00Z',
        '2026-07-20T22:15:00Z');

-- ---------------------------------------------------------------------------
-- 2. WALLET — 5000 HSMC balance
-- ---------------------------------------------------------------------------
INSERT INTO wallets (id, user_id, address, balance, staked_balance, label, is_primary, created_at, updated_at)
VALUES ('wal_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
        'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
        'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
        5000.0,
        1500.0,
        'Main Wallet',
        1,
        '2026-06-21T08:00:00Z',
        '2026-07-21T09:45:00Z');

INSERT INTO wallet_seeds (id, user_id, wallet_address, encrypted_seed, created_at, updated_at)
VALUES ('wsd_c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6',
        'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
        'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
        'AES256:iv=8a7b6c5d:eNcRyPtEdSeEdBaG==',
        '2026-06-21T08:00:00Z',
        '2026-06-21T08:00:00Z');

-- ---------------------------------------------------------------------------
-- 3. TRANSACTIONS — 9 realiste (send, receive, stake, swap)
-- ---------------------------------------------------------------------------
INSERT INTO transactions (id, hash, from_address, to_address, amount, fee, status, privacy_level,
                          block_number, commitment, decoy_count, range_proof, ring_signature,
                          stealth_address, created_at, confirmed_at)
VALUES
-- TX 1: Receive 3000 HSMC from external (initial deposit)
('txn_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
 '0x8f3a9b1c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a',
 'hsmc1qz9x8y7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 3000.0, 0.002, 'confirmed', 'RingCT',
 9876.0,
 'Pedersen:9f8e7d6c5b4a39281706',
 11.0,
 'Bulletproof:b4s3e64:ok',
 'CLSAG:sig_01a2b3c4d5=valid',
 NULL,
 '2026-06-22T14:30:00Z', '2026-06-22T14:32:00Z'),

-- TX 2: Receive 2500 HSMC from external (second deposit)
('txn_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
 '0x9e4a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9',
 'hsmc1qy8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 2500.0, 0.002, 'confirmed', 'Stealth',
 10012.0,
 'Pedersen:8e7d6c5b4a39281706',
 16.0,
 'Bulletproof:c3d2e1f0:ok',
 'CLSAG:sig_02b3c4d5e6=valid',
 'stealth_hsmc1qx7y8z9a0b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5',
 '2026-06-25T09:15:00Z', '2026-06-25T09:18:00Z'),

-- TX 3: Send 200 HSMC to friend
('txn_3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f',
 '0x7d3a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 'hsmc1qw9x8y7z6a5b4c3d2e1f0g9h8i7j6k5l4m3n2',
 200.0, 0.0015, 'confirmed', 'RingCT',
 10150.0,
 'Pedersen:7d6c5b4a39281706',
 11.0,
 'Bulletproof:a1b2c3d4:ok',
 'CLSAG:sig_03c4d5e6f7=valid',
 NULL,
 '2026-06-28T16:45:00Z', '2026-06-28T16:47:00Z'),

-- TX 4: Swap 500 HSMC → USDT via internal DEX
('txn_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
 '0x6c2a8b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 'hsmc1qswap000000000000000000000000000000000000',
 500.0, 0.003, 'confirmed', 'Transparent',
 10201.0,
 NULL,
 0.0,
 NULL,
 NULL,
 NULL,
 '2026-07-01T11:00:00Z', '2026-07-01T11:02:00Z'),

-- TX 5: Stake 1000 HSMC → Genesis Pool
('txn_5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
 '0x5b1a7b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 'hsmc1qstaking_genesis_pool_validator_01',
 1000.0, 0.002, 'confirmed', 'Transparent',
 10250.0,
 NULL,
 0.0,
 NULL,
 NULL,
 NULL,
 '2026-07-03T08:30:00Z', '2026-07-03T08:32:00Z'),

-- TX 6: Receive 450 HSMC — mining reward
('txn_6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
 '0x4a0a6b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
 'hsmc1qcoinbase000000000000000000000000000000000000',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 450.0, 0.0, 'confirmed', 'Transparent',
 10312.0,
 NULL,
 0.0,
 NULL,
 NULL,
 NULL,
 '2026-07-08T06:15:00Z', '2026-07-08T06:16:00Z'),

-- TX 7: Send 100 HSMC — payment via HSMCPay (Stripe)
('txn_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
 '0x39f95a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 'hsmc1qmerchant_acme_inc_payments',
 100.0, 0.0015, 'confirmed', 'RingCT',
 10380.0,
 'Pedersen:3b2a19081706',
 11.0,
 'Bulletproof:d4c3b2a1:ok',
 'CLSAG:sig_07a8b9c0d1=valid',
 NULL,
 '2026-07-10T14:20:00Z', '2026-07-10T14:22:00Z'),

-- TX 8: Swap 300 HSMC → BNB
('txn_8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e',
 '0x28e84a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 'hsmc1qswap000000000000000000000000000000000000',
 300.0, 0.0025, 'confirmed', 'Transparent',
 10410.0,
 NULL,
 0.0,
 NULL,
 NULL,
 NULL,
 '2026-07-14T10:45:00Z', '2026-07-14T10:47:00Z'),

-- TX 9: Send 50 HSMC — test privacy tx (RingCT + stealth)
('txn_9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f',
 '0x17d73a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 'hsmc1qtest_wallet_dev_friend_0x7f3a9b2c',
 50.0, 0.001, 'confirmed', 'Full',
 10442.0,
 'Pedersen:1d0c9b8a7',
 16.0,
 'Bulletproof:e5f4a3b2:ok',
 'CLSAG:sig_09c0d1e2f3=valid',
 'stealth_hsmc1qy9z8a7b6c5d4e3f2g1h0i9j8k7l6m5n4o3p2',
 '2026-07-18T22:10:00Z', '2026-07-18T22:12:00Z');

-- ---------------------------------------------------------------------------
-- 4. STAKING POOLS — 3 pools
-- ---------------------------------------------------------------------------
INSERT INTO staking_pools (id, name, apr, commission_rate, min_stake, total_staked, status,
                           validator_address, created_at)
VALUES
('stk_genesis_01',
 'Genesis Pool',
 12.5, 2.0, 100.0, 125000.0, 'active',
 'hsmc1qstaking_genesis_pool_validator_01',
 '2026-06-21T12:00:00Z'),

('stk_beta_02',
 'Beta Pool',
 18.0, 5.0, 500.0, 87500.0, 'active',
 'hsmc1qstaking_beta_pool_validator_02',
 '2026-06-28T10:00:00Z'),

('stk_community_03',
 'Community Pool',
 8.0, 0.0, 10.0, 32400.0, 'active',
 'hsmc1qstaking_community_pool_validator_03',
 '2026-07-01T16:00:00Z');

-- ---------------------------------------------------------------------------
-- 5. STAKES — pozitii in Genesis Pool si Beta Pool
-- ---------------------------------------------------------------------------
INSERT INTO stakes (id, user_id, pool_id, amount, staked_at, status, rewards_earned,
                    rewards_claimed, last_reward_at, unstake_at)
VALUES
('stk_pos_01',
 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'stk_genesis_01',
 1000.0, '2026-07-03T08:32:00Z', 'active',
 6.16, 0.0, '2026-07-21T00:00:00Z', NULL),

('stk_pos_02',
 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'stk_beta_02',
 500.0, '2026-07-10T15:00:00Z', 'active',
 2.71, 0.0, '2026-07-21T00:00:00Z', NULL),

('stk_pos_03',
 'usr_b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e',
 'stk_genesis_01',
 5000.0, '2026-07-05T09:00:00Z', 'active',
 27.40, 0.0, '2026-07-21T00:00:00Z', NULL);

-- ---------------------------------------------------------------------------
-- 6. LIQUIDITY POOLS — 2 pools (HSMC/USDT, HSMC/BNB)
-- ---------------------------------------------------------------------------
INSERT INTO liquidity_pools (id, pool_address, pair_token, dex_name, chain_name, pool_type,
                             reserve_hsmc, reserve_pair, total_lp_tokens, fee_bps, status,
                             created_at, updated_at)
VALUES
('liq_hsmc_usdt_01',
 '0x7F3A9B2C1D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A',
 'USDT', 'HSMCswap', 'BSC', 'constant_product',
 2500000.0, 112500.0, 16770509.0, 30, 'active',
 '2026-06-21T12:00:00Z', '2026-07-21T09:00:00Z'),

('liq_hsmc_bnb_02',
 '0x8A4B2C3D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B',
 'BNB', 'HSMCswap', 'BSC', 'constant_product',
 1800000.0, 320.0, 24000.0, 25, 'active',
 '2026-07-01T10:00:00Z', '2026-07-21T09:00:00Z');

-- ---------------------------------------------------------------------------
-- 7. LP POSITIONS — pozitia user-ului in HSMC/USDT
-- ---------------------------------------------------------------------------
INSERT INTO lp_positions (id, user_id, pool_id, hsmc_deposited, pair_deposited, lp_tokens,
                          fees_earned, created_at, updated_at)
VALUES
('lpp_01',
 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'liq_hsmc_usdt_01',
 2500.0, 112.5, 16770.51, 3.45,
 '2026-07-05T14:00:00Z', '2026-07-21T09:00:00Z');

-- ---------------------------------------------------------------------------
-- 8. TOKEN METRICS — conform cerintei
-- ---------------------------------------------------------------------------
INSERT INTO token_metrics (id, price, market_cap, total_supply, circulating_supply,
                           staked_supply, fully_diluted_valuation, token_holders,
                           price_change_24h, market_cap_change_24h,
                           volume_24h, volume_change_24h,
                           all_time_high, all_time_high_date, ytd_return,
                           updated_at)
VALUES
('tkm_20260721',
 0.045,
 22500000.0,
 500000000.0,
 500000000.0,
 244900.0,
 22500000.0,
 12450,
 2.3,
 1.8,
 485000.0,
 12.5,
 0.087,
 '2026-07-15T00:00:00Z',
 28.6,
 '2026-07-21T10:00:00Z');

-- ---------------------------------------------------------------------------
-- 9. PRICE HISTORY — 10 puncte pe ultimele 30 de zile
-- ---------------------------------------------------------------------------
INSERT INTO price_history (id, price, volume, timestamp)
VALUES
('ph_01', 0.032, 125000.0, '2026-06-21T00:00:00Z'),
('ph_02', 0.035, 142000.0, '2026-06-25T00:00:00Z'),
('ph_03', 0.038, 168000.0, '2026-06-29T00:00:00Z'),
('ph_04', 0.041, 210000.0, '2026-07-03T00:00:00Z'),
('ph_05', 0.039, 185000.0, '2026-07-07T00:00:00Z'),
('ph_06', 0.043, 290000.0, '2026-07-10T00:00:00Z'),
('ph_07', 0.047, 345000.0, '2026-07-13T00:00:00Z'),
('ph_08', 0.044, 312000.0, '2026-07-16T00:00:00Z'),
('ph_09', 0.046, 425000.0, '2026-07-19T00:00:00Z'),
('ph_10', 0.045, 385000.0, '2026-07-21T00:00:00Z');

-- ---------------------------------------------------------------------------
-- 10. NETWORK STATS
-- ---------------------------------------------------------------------------
INSERT INTO network_stats (id, active_nodes, block_height, hash_rate, network_difficulty,
                           total_transactions, tps, latency, consensus_state, updated_at)
VALUES
('nws_20260721',
 12.0,
 10456.0,
 '25.00 KH/s',
 1875000.0,
 345210.0,
 4.2,
 45.0,
 'synchronized',
 '2026-07-21T10:00:00Z');

-- ---------------------------------------------------------------------------
-- 11. NETWORK PEERS — 12 noduri active
-- ---------------------------------------------------------------------------
INSERT INTO network_peers (id, peer_id, ip_address, port, region, status, version, latency,
                           created_at, last_seen_at)
VALUES
('nwp_01', '12D3KooWHsmcNODE01AbcDeFgHiJkLmNoPqRsTuVwXyZ', '45.33.12.101',   8333.0, 'us-east',    'online', 'v0.3.1', 42.0,  '2026-06-21T12:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_02', '12D3KooWHsmcNODE02BcdEfGhIjKlMnOpQrStUvWxYzA', '159.89.45.200',  8333.0, 'eu-west',    'online', 'v0.3.1', 55.0,  '2026-06-22T08:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_03', '12D3KooWHsmcNODE03CdeFgHiJkLmNoPqRsTuVwXyZa', '138.68.22.150',  8333.0, 'eu-central', 'online', 'v0.3.1', 38.0,  '2026-06-23T14:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_04', '12D3KooWHsmcNODE04DefGhIjKlMnOpQrStUvWxYzAb', '104.248.78.90',  8333.0, 'us-west',    'online', 'v0.3.1', 68.0,  '2026-06-24T09:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_05', '12D3KooWHsmcNODE05EfgHiJkLmNoPqRsTuVwXyZAc', '178.62.33.44',   8333.0, 'ap-south',   'online', 'v0.3.1', 120.0, '2026-06-25T16:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_06', '12D3KooWHsmcNODE06FghIjKlMnOpQrStUvWxYzAd', '167.99.55.66',   8333.0, 'ap-east',    'online', 'v0.3.1', 145.0, '2026-06-26T11:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_07', '12D3KooWHsmcNODE07GhiJkLmNoPqRsTuVwXyZAe', '142.93.88.77',   8333.0, 'sa-east',    'online', 'v0.3.0', 180.0, '2026-06-27T07:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_08', '12D3KooWHsmcNODE08HijKlMnOpQrStUvWxYzAf', '64.225.12.99',   8333.0, 'us-central', 'online', 'v0.3.1', 52.0,  '2026-06-28T13:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_09', '12D3KooWHsmcNODE09IjkLmNoPqRsTuVwXyZAg', '157.245.44.10',  8333.0, 'eu-north',   'online', 'v0.3.1', 72.0,  '2026-06-29T18:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_10', '12D3KooWHsmcNODE10JklMnOpQrStUvWxYzAh', '139.59.66.33',   8333.0, 'ap-southeast','online','v0.3.1', 98.0,  '2026-07-01T05:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_11', '12D3KooWHsmcNODE11KlmNoPqRsTuVwXyZAi', '188.166.99.44',  8333.0, 'eu-west-2',  'online', 'v0.3.1', 63.0,  '2026-07-05T10:00:00Z', '2026-07-21T10:00:00Z'),
('nwp_12', '12D3KooWHsmcNODE12LmnOpQrStUvWxYzAj', '165.22.77.88',   8333.0, 'us-east-2',  'online', 'v0.3.1', 47.0,  '2026-07-10T20:00:00Z', '2026-07-21T10:00:00Z');

-- ---------------------------------------------------------------------------
-- 12. GOVERNANCE — 1 propunere activa
-- ---------------------------------------------------------------------------
INSERT INTO governance_proposals (id, title, description, proposal_type, parameter_key,
                                  parameter_value, proposer_address, user_id, status,
                                  quorum_required, votes_for, votes_against,
                                  created_at, ends_at)
VALUES
('gov_001',
 'Increase Genesis Pool APR to 15%',
 'Proposal to raise the Genesis staking pool APR from 12.5% to 15.0% over a 6-month trial period. '
 || 'The additional rewards will be sourced from the Treasury buyback allocation, reducing buyback from 40% to 38%. '
 || 'If community adoption of Genesis staking increases by >20%, the change becomes permanent.',
 'parameter_change',
 'staking_pools.apr',
 '15.0',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'active',
 250000.0,
 187500.0,
 42300.0,
 '2026-07-14T12:00:00Z',
 '2026-07-28T12:00:00Z');

-- ---------------------------------------------------------------------------
-- 13. GOVERNANCE VOTES
-- ---------------------------------------------------------------------------
INSERT INTO governance_votes (id, proposal_id, user_id, voter_address, vote_choice, vote_weight,
                              created_at)
VALUES
('gvt_001', 'gov_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p', 'for', 6500.0, '2026-07-14T13:00:00Z'),
('gvt_002', 'gov_001', 'usr_b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e',
 'hsmc1qb8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f', 'for', 12000.0, '2026-07-15T09:00:00Z'),
('gvt_003', 'gov_001', 'usr_c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f',
 'hsmc1qc9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a', 'against', 8500.0, '2026-07-16T14:00:00Z'),
('gvt_004', 'gov_001', 'usr_d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a',
 'hsmc1qd0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b', 'for', 3400.0, '2026-07-17T11:00:00Z');

-- ---------------------------------------------------------------------------
-- 14. TREASURY TRANSACTIONS
-- ---------------------------------------------------------------------------
INSERT INTO treasury_transactions (id, amount_usd, fee_hsmc, fee_tier, type, status, tx_hash,
                                   created_at, notes)
VALUES
('trs_001', 450.00,   10.0, 'sub_6000',   'buy_fee',  'settled',
 '0xab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2', '2026-07-10T14:22:00Z',
 'HSMCPay merchant payment fee — Acme Inc'),
('trs_002', 1200.00,  10.0, 'sub_6000',   'buy_fee',  'settled',
 '0xbc2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3', '2026-07-12T10:00:00Z',
 'HSMCPay merchant payment fee'),
('trs_003', 85000.00, 10.0, '50000_1000000','buy_fee', 'settled',
 '0xcd3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4', '2026-07-15T16:45:00Z',
 'HSMCPay large merchant settlement'),
('trs_004', 5000.00,  0.0,  'internal',   'buyback',  'settled',
 '0xde4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5', '2026-07-18T08:00:00Z',
 'Treasury buyback — 111,111 HSMC purchased and burned'),
('trs_005', 3125.00,  0.0,  'internal',   'staking_reward', 'settled',
 '0xef5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6', '2026-07-21T00:01:00Z',
 'Daily staking rewards distribution');

-- ---------------------------------------------------------------------------
-- 15. SWAP RATES — HSMC ↔ USDT, HSMC ↔ BNB
-- ---------------------------------------------------------------------------
INSERT INTO swap_rates (id, from_token, to_token, rate, updated_at)
VALUES
('swr_01', 'HSMC', 'USDT', 0.045, '2026-07-21T10:00:00Z'),
('swr_02', 'USDT', 'HSMC', 22.222, '2026-07-21T10:00:00Z'),
('swr_03', 'HSMC', 'BNB',  0.000075, '2026-07-21T10:00:00Z'),
('swr_04', 'BNB',  'HSMC', 13333.33, '2026-07-21T10:00:00Z');

-- ---------------------------------------------------------------------------
-- 16. TOKEN SWAPS — 2 swap-uri facute de user
-- ---------------------------------------------------------------------------
INSERT INTO token_swaps (id, user_id, from_token, to_token, from_amount, to_amount, rate,
                         slippage, status, privacy_level, tx_hash, created_at)
VALUES
('tsw_01', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'HSMC', 'USDT', 500.0, 22.5, 0.045, 0.5, 'completed', 'Transparent',
 '0x6c2a8b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
 '2026-07-01T11:02:00Z'),

('tsw_02', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'HSMC', 'BNB', 300.0, 0.0225, 0.000075, 0.8, 'completed', 'Transparent',
 '0x28e84a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
 '2026-07-14T10:47:00Z');

-- ---------------------------------------------------------------------------
-- 17. POOL EVENTS — add/remove liquidity
-- ---------------------------------------------------------------------------
INSERT INTO pool_events (id, pool_id, user_id, event_type, hsmc_delta, pair_delta, price_after,
                         tx_hash, created_at)
VALUES
('ple_01', 'liq_hsmc_usdt_01', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'add_liquidity', 2500.0, 112.5, 0.045,
 '0x11a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
 '2026-07-05T14:00:00Z');

-- ---------------------------------------------------------------------------
-- 18. PLATFORM CONFIG — default enabled
-- ---------------------------------------------------------------------------
INSERT INTO platform_config (id, hsmcpay_intermediary_enabled, updated_at, updated_by)
VALUES (1, 1, '2026-07-21T10:00:00Z', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c');

-- ---------------------------------------------------------------------------
-- 19. PLATFORM STATS
-- ---------------------------------------------------------------------------
INSERT INTO platform_stats (id, tvl, developers_count, countries_count, uptime_percent, updated_at)
VALUES ('pst_20260721', 1125000.0, 34.0, 22.0, 99.97, '2026-07-21T10:00:00Z');

-- ---------------------------------------------------------------------------
-- 20. BLOCKS — 3 blocuri recente (context pentru tranzactii)
-- ---------------------------------------------------------------------------
INSERT INTO blocks (id, hash, block_number, prev_hash, miner_address, nonce, difficulty,
                    transactions_count, privacy_protocol, created_at)
VALUES
('blk_10454', '0x000000a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9',
 10454.0,
 '0x000000b1c2d3e4f5a6b7c8d9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0',
 'hsmc1qminer_node_us_east_01', 2847561.0, 1875000.0, 3.0, 'RingCT+Stealth',
 '2026-07-21T09:55:00Z'),

('blk_10455', '0x000000c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5b6c7d8e9',
 10455.0,
 '0x000000a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9',
 'hsmc1qminer_node_eu_west_02', 3912456.0, 1875000.0, 2.0, 'RingCT+Stealth',
 '2026-07-21T09:58:00Z'),

('blk_10456', '0x000000d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6b7c8d9e',
 10456.0,
 '0x000000c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5b6c7d8e9',
 'hsmc1qminer_node_ap_south_05', 1248933.0, 1875000.0, 4.0, 'RingCT+Stealth',
 '2026-07-21T10:01:00Z');

-- ---------------------------------------------------------------------------
-- 21. NOTIFICATIONS — cateva pentru user
-- ---------------------------------------------------------------------------
INSERT INTO notifications (id, user_id, type, title, message, data, read, created_at)
VALUES
('ntf_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'staking_reward', 'Staking Reward Received',
 'You earned 0.42 HSMC in staking rewards from Genesis Pool.',
 '{"pool":"stk_genesis_01","amount":0.42}', 0, '2026-07-21T00:01:00Z'),

('ntf_002', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'governance', 'Governance Proposal #001 Update',
 'Proposal "Increase Genesis Pool APR to 15%" has reached 81.6% approval. 6 days remaining.',
 '{"proposal_id":"gov_001","for":187500,"against":42300}', 1, '2026-07-20T18:30:00Z'),

('ntf_003', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'transaction', 'Transaction Confirmed',
 'Your payment of 100 HSMC via HSMCPay to Acme Inc has been settled.',
 '{"tx_hash":"0x39f95...","amount":100}', 1, '2026-07-10T14:22:00Z');

-- ---------------------------------------------------------------------------
-- 22. PAYMENT SESSIONS — HSMCPay
-- ---------------------------------------------------------------------------
INSERT INTO payment_sessions (id, user_id, session_id, amount_hsmc, amount_usd, processor,
                              card_brand, card_last4, card_holder, stripe_payment_intent_id,
                              stripe_client_secret, status, otp_code, otp_expires_at,
                              settlement_tx_hash, created_at)
VALUES
('psn_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'sess_a1b2c3d4e5', 100.0, 4.50, 'stripe',
 'visa', '4242', 'Demo User',
 'pi_3NkX7fHSMCdemo0001',
 'pi_3NkX7fHSMCdemo0001_secret_XyZ123',
 'settled', NULL, NULL,
 '0x39f95a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
 '2026-07-10T14:15:00Z'),

('psn_002', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'sess_b2c3d4e5f6', 200.0, 9.00, 'stripe',
 'mastercard', '5555', 'Demo User',
 'pi_3NkX8gHSMCdemo0002',
 'pi_3NkX8gHSMCdemo0002_secret_AbC456',
 'pending', '482917', '2026-07-21T10:05:00Z',
 NULL,
 '2026-07-21T10:00:00Z');

-- ---------------------------------------------------------------------------
-- 23. PAYMENT LINKS
-- ---------------------------------------------------------------------------
INSERT INTO payment_links (id, user_id, slug, token, description, amount, wallet_address,
                           active, total_received, payments_count, created_at)
VALUES
('plk_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'donate-hsmc', 'HSMC', 'Support HSMC Network development — donation link',
 50.0, 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 1, 350.0, 7.0, '2026-07-01T08:00:00Z'),

('plk_002', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'acme-invoice-042', 'HSMC', 'Acme Inc — Invoice #042 monthly retainer',
 100.0, 'hsmc1q8x9y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
 1, 100.0, 1.0, '2026-07-10T14:00:00Z');

-- ---------------------------------------------------------------------------
-- 24. INTERNAL TRANSFERS
-- ---------------------------------------------------------------------------
INSERT INTO internal_transfers (id, user_id, from_wallet_id, to_wallet_id, amount, note, created_at)
VALUES
('itf_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'wal_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
 'wal_savings_b1c2d3e4f5a6b7c8d9e0f1a2',
 500.0, 'Move to savings sub-wallet', '2026-07-15T12:00:00Z');

-- ---------------------------------------------------------------------------
-- 25. REFERRAL CODES
-- ---------------------------------------------------------------------------
INSERT INTO referral_codes (id, user_id, code, created_at)
VALUES ('ref_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
        'DEMO-HSMC-2026', '2026-07-01T08:00:00Z');

-- ---------------------------------------------------------------------------
-- 26. REFERRAL USES
-- ---------------------------------------------------------------------------
INSERT INTO referral_uses (id, referral_code_id, referrer_user_id, referred_user_id,
                           bonus_amount, bonus_paid, created_at)
VALUES
('rfu_001', 'ref_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'usr_b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e', 25.0, 1, '2026-07-05T10:00:00Z'),
('rfu_002', 'ref_001', 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'usr_c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f', 25.0, 1, '2026-07-12T16:00:00Z');

-- ---------------------------------------------------------------------------
-- 27. NEWSLETTER SUBSCRIBERS
-- ---------------------------------------------------------------------------
INSERT INTO newsletter_subscribers (id, email, source, created_at)
VALUES
('nls_001', 'demo@hsmc.network', 'web_signup', '2026-06-21T08:05:00Z'),
('nls_002', 'investor@crypto-fund.vc', 'landing_page', '2026-07-10T15:30:00Z');

-- ---------------------------------------------------------------------------
-- 28. DEPLOYMENT STATUS
-- ---------------------------------------------------------------------------
INSERT INTO deployment_status (id, network, contract_address, pair_address, explorer_url,
                               status, step_id, tx_hash, created_by, notes, created_at, updated_at)
VALUES
('dep_001', 'BSC',
 '0x7F3A9B2C1D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A',
 '0x8A4B2C3D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B',
 'https://bscscan.com/address/0x7F3A9B2C1D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A',
 'deployed', 'wHSMC_token',
 '0xdeploy_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
 'usr_7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c',
 'wHSMC wrapped token on BSC mainnet — initial deployment',
 '2026-07-01T12:00:00Z', '2026-07-01T12:05:00Z');

-- Done. 28+ INSERT statements with realistic data across 28 tables.
