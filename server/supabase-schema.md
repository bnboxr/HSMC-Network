# HSMC Database Schema

Generated 2026-07-21T18:53:02.004Z

## Tables (35)

### blocks
| Column | Type |
|--------|------|
| block_number | number |
| created_at | string |
| difficulty | number |
| hash | string |
| id | string |
| miner_address | string |
| nonce | number |
| prev_hash | string |
| privacy_protocol | string | null |
| transactions_count | number |

### contract_interactions
| Column | Type |
|--------|------|
| caller_address | string |
| contract_id | string |
| created_at | string |
| function_name | string |
| gas_used | number |
| id | string |
| inputs | Json | null |
| outputs | Json | null |
| status | string |
| tx_hash | string |

### deployment_status
| Column | Type |
|--------|------|
| contract_address | string | null |
| created_at | string |
| created_by | string | null |
| explorer_url | string | null |
| id | string |
| network | string |
| notes | string | null |
| pair_address | string | null |
| status | string |
| step_id | string |
| tx_hash | string | null |
| updated_at | string |

### governance_proposals
| Column | Type |
|--------|------|
| created_at | string |
| description | string |
| ends_at | string |
| id | string |
| parameter_key | string | null |
| parameter_value | string | null |
| proposal_type | string |
| proposer_address | string |
| quorum_required | number |
| status | string |
| title | string |
| user_id | string | null |
| votes_against | number |
| votes_for | number |

### governance_votes
| Column | Type |
|--------|------|
| created_at | string |
| id | string |
| proposal_id | string |
| user_id | string |
| vote_choice | string |
| vote_weight | number |
| voter_address | string |

### internal_transfers
| Column | Type |
|--------|------|
| amount | number |
| created_at | string |
| from_wallet_id | string |
| id | string |
| note | string | null |
| to_wallet_id | string |
| user_id | string |

### liquidity_pools
| Column | Type |
|--------|------|
| chain_name | string | null |
| created_at | string |
| dex_name | string | null |
| fee_bps | number |
| id | string |
| pair_token | string |
| pool_address | string | null |
| pool_type | string |
| reserve_hsmc | number |
| reserve_pair | number |
| status | string |
| total_lp_tokens | number |
| updated_at | string |

### lp_positions
| Column | Type |
|--------|------|
| created_at | string |
| fees_earned | number |
| hsmc_deposited | number |
| id | string |
| lp_tokens | number |
| pair_deposited | number |
| pool_id | string |
| updated_at | string |
| user_id | string |

### network_peers
| Column | Type |
|--------|------|
| created_at | string |
| id | string |
| ip_address | string |
| last_seen_at | string |
| latency | number |
| peer_id | string |
| port | number |
| region | string |
| status | string |
| version | string |

### network_stats
| Column | Type |
|--------|------|
| active_nodes | number |
| block_height | number |
| consensus_state | string |
| hash_rate | string |
| id | string |
| latency | number |
| network_difficulty | number |
| total_transactions | number |
| tps | number |
| updated_at | string |

### newsletter_subscribers
| Column | Type |
|--------|------|
| created_at | string |
| email | string |
| id | string |
| source | string |

### notifications
| Column | Type |
|--------|------|
| created_at | string |
| data | Json | null |
| id | string |
| message | string |
| read | boolean |
| title | string |
| type | string |
| user_id | string | null |

### payment_links
| Column | Type |
|--------|------|
| active | boolean |
| amount | number | null |
| created_at | string |
| description | string | null |
| id | string |
| payments_count | number |
| slug | string |
| token | string |
| total_received | number |
| user_id | string |
| wallet_address | string |

### payment_sessions
| Column | Type |
|--------|------|
| amount_hsmc | number |
| amount_usd | number |
| card_brand | string |
| card_holder | string |
| card_last4 | string |
| created_at | string |
| id | string |
| otp_attempts | number |
| otp_code | string |
| otp_expires_at | string |
| processor | string |
| session_id | string |
| settlement_tx_hash | string | null |
| status | string |
| stripe_client_secret | string | null |
| stripe_payment_intent_id | string | null |
| user_id | string |

### platform_config
| Column | Type |
|--------|------|
| hsmcpay_intermediary_enabled | boolean |
| id | number |
| updated_at | string |
| updated_by | string | null |

### platform_stats
| Column | Type |
|--------|------|
| countries_count | number |
| developers_count | number |
| id | string |
| tvl | number |
| updated_at | string |
| uptime_percent | number |

### pool_events
| Column | Type |
|--------|------|
| created_at | string |
| event_type | string |
| hsmc_delta | number |
| id | string |
| pair_delta | number |
| payment_ref | string | null |
| pool_id | string |
| price_after | number | null |
| tx_hash | string | null |
| user_id | string | null |

### price_history
| Column | Type |
|--------|------|
| id | string |
| price | number |
| timestamp | string |
| volume | number |

### profiles
| Column | Type |
|--------|------|
| avatar_url | string | null |
| created_at | string |
| id | string |
| updated_at | string |
| user_id | string |
| username | string | null |
| wallet_address | string | null |

### referral_codes
| Column | Type |
|--------|------|
| code | string |
| created_at | string |
| id | string |
| user_id | string |

### referral_uses
| Column | Type |
|--------|------|
| bonus_amount | number |
| bonus_paid | boolean |
| created_at | string |
| id | string |
| referral_code_id | string |
| referred_user_id | string |
| referrer_user_id | string |

### settings_schema
| Column | Type |
|--------|------|
| category | string |
| description | string |
| display_order | number |
| example_value | string | null |
| is_secret | boolean |
| key | string |
| label | string |
| required_for | string[] |
| validation_regex | string | null |

### smart_contracts
| Column | Type |
|--------|------|
| abi | Json | null |
| address | string |
| bytecode | string | null |
| contract_type | string |
| created_at | string |
| deployed_at | string |
| deployer_address | string |
| id | string |
| interactions_count | number |
| name | string |
| source_code | string | null |
| status | string |
| user_id | string | null |
| version | string |

### stakes
| Column | Type |
|--------|------|
| amount | number |
| id | string |
| last_reward_at | string |
| pool_id | string |
| rewards_claimed | number |
| rewards_earned | number |
| staked_at | string |
| status | string |
| unstake_at | string | null |
| user_id | string |

### staking_pools
| Column | Type |
|--------|------|
| apr | number |
| commission_rate | number |
| created_at | string |
| id | string |
| min_stake | number |
| name | string |
| status | string |
| total_staked | number |
| validator_address | string |

### swap_rates
| Column | Type |
|--------|------|
| from_token | string |
| id | string |
| rate | number |
| to_token | string |
| updated_at | string |

### token_metrics
| Column | Type |
|--------|------|
| all_time_high | number |
| all_time_high_date | string |
| circulating_supply | number |
| fully_diluted_valuation | number |
| id | string |
| market_cap | number |
| market_cap_change_24h | number |
| price | number |
| price_change_24h | number |
| staked_supply | number |
| token_holders | number |
| total_supply | number |
| updated_at | string |
| volume_24h | number |
| volume_change_24h | number |
| ytd_return | number |

### token_swaps
| Column | Type |
|--------|------|
| created_at | string |
| from_amount | number |
| from_token | string |
| id | string |
| privacy_level | string |
| rate | number |
| slippage | number |
| status | string |
| to_amount | number |
| to_token | string |
| tx_hash | string |
| user_id | string |

### totp_secrets
| Column | Type |
|--------|------|
| backup_codes | string[] |
| created_at | string |
| enabled | boolean |
| id | string |
| secret | string |
| updated_at | string |
| user_id | string |

### transactions
| Column | Type |
|--------|------|
| amount | number |
| block_number | number | null |
| commitment | string | null |
| confirmed_at | string | null |
| created_at | string |
| decoy_count | number | null |
| fee | number |
| from_address | string |
| hash | string |
| id | string |
| privacy_level | string | null |
| range_proof | string | null |
| ring_signature | string | null |
| status | string |
| stealth_address | string | null |
| to_address | string |

### user_roles
| Column | Type |
|--------|------|
| created_at | string |
| id | string |
| role | Database["public"]["Enums"]["app_role"] |
| user_id | string |

### user_settings
| Column | Type |
|--------|------|
| created_at | string |
| id | string |
| setting_key | string |
| setting_value | string |
| updated_at | string |
| user_id | string |

### wallet_seeds
| Column | Type |
|--------|------|
| created_at | string |
| encrypted_seed | string |
| id | string |
| updated_at | string |
| user_id | string |
| wallet_address | string |

### wallets
| Column | Type |
|--------|------|
| address | string |
| balance | number |
| created_at | string |
| id | string |
| is_primary | boolean |
| label | string |
| staked_balance | number |
| updated_at | string |
| user_id | string |

### payment_sessions_safe
| Column | Type |
|--------|------|
| amount_hsmc | number | null |
| amount_usd | number | null |
| card_brand | string | null |
| card_last4 | string | null |
| created_at | string | null |
| id | string | null |
| otp_expires_at | string | null |
| session_id | string | null |
| status | string | null |
| user_id | string | null |

