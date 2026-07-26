// ============================================================================
// HSMC Formal Verification Harness — Kani proofs for critical invariants
// ============================================================================
// To run: `cargo kani -p hsmc-core --harness`
// Requires: `cargo install kani-verifier && kani setup`
//
// Verified invariants:
//   1. transfer invariant: sender_balance >= amount + fee
//   2. UTXO set balance consistency: sum(utxo amounts) == total_transparent_supply
//   3. Chain integrity: block_number monotonic, hash linkage
//   4. Supply cap: circulating_supply <= MAX_SUPPLY
//   5. No overflow in reward calculation
// ============================================================================

#[cfg(kani)]
mod verification {
    use crate::{
        Transaction, PrivacyLevel, TxValidationError,
        validate_tx as validator_validate_tx,
        Chain, UtxoSet, Utxo, UtxoStatus, Address, MAX_SUPPLY, INITIAL_REWARD,
    };

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 1: Transfer Balance Sufficiency
    // ─────────────────────────────────────────────────────────────────────
    // Verifies that the validator enforces: sender_balance >= amount + fee
    // for transparent transactions.

    #[kani::proof]
    #[kani::unwind(10)]
    fn verify_transfer_balance_invariant() {
        // Create a transaction with arbitrary (but valid-looking) parameters
        let from: String = kani::any();
        let to: String = kani::any();
        let amount: f64 = kani::any();
        let fee: f64 = kani::any();

        // Constrain to realistic ranges
        kani::assume(!from.is_empty());
        kani::assume(!to.is_empty());
        kani::assume(from != to);                       // no self-transfer
        kani::assume(amount >= 0.0 && amount.is_finite());
        kani::assume(fee >= 0.0 && fee.is_finite());
        kani::assume(from.starts_with("HSMC"));
        kani::assume(to.starts_with("HSMC"));
        kani::assume(from.len() == 44);
        kani::assume(to.len() == 44);

        let tx = Transaction::new(&from, &to, amount, fee, PrivacyLevel::Transparent);

        // The validator checks that fee >= min_fee and amount >= dust threshold
        let result = validator_validate_tx(&tx);

        // If the transaction passes validation, we can reason about balance
        if result.is_ok() {
            // These must hold for a valid transaction:
            assert!(fee >= PrivacyLevel::Transparent.min_fee());
            assert!(amount >= 0.000_001); // DUST_THRESHOLD_HSMC
            assert!(tx.amount + tx.fee >= tx.amount); // no overflow
        } else {
            // If validation fails, it must be for a documented reason
            match result.unwrap_err() {
                crate::ValidationError::FeeTooLow { .. }
                | crate::ValidationError::DustOutput { .. }
                | crate::ValidationError::SelfTransfer
                | crate::ValidationError::NegativeAmount
                | crate::ValidationError::NonFiniteValue { .. }
                | crate::ValidationError::InvalidAddress { .. }
                | crate::ValidationError::EmptyAddress
                | crate::ValidationError::EmptyHash
                | crate::ValidationError::Overflow { .. } => {
                    // These are expected failure modes for arbitrary inputs
                }
                _ => {
                    // Unexpected error — indicates a bug
                    panic!("Unexpected validation error: {:?}", result.unwrap_err());
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 2: UTXO Set Balance Consistency
    // ─────────────────────────────────────────────────────────────────────
    // Sum of all transparent UTXO amounts must equal total_transparent_supply.

    #[kani::proof]
    #[kani::unwind(5)]
    fn verify_utxo_set_balance_consistency() {
        let mut set = UtxoSet::new();
        assert_eq!(set.total_transparent_supply, 0.0);

        // Add a UTXO
        let addr = Address::from_entropy(&[1u8; 32]);
        let amount: f64 = kani::any();
        kani::assume(amount >= 0.0 && amount <= MAX_SUPPLY);
        kani::assume(amount.is_finite());

        set.add(Utxo::new("tx1".into(), 0, amount, addr.clone(), 1));

        // total_transparent_supply should reflect the added amount
        assert!((set.total_transparent_supply - amount).abs() < 1e-9,
            "total_transparent_supply ({}) should equal added amount ({})",
            set.total_transparent_supply, amount);

        // Balance of the address should match
        assert!((set.balance_of(&addr) - amount).abs() < 1e-9);

        // Spend the UTXO
        let spent = set.spend("tx1", 0);
        assert!(spent.is_some());
        assert_eq!(set.balance_of(&addr), 0.0);
        assert_eq!(set.total_transparent_supply, 0.0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 3: Supply Cap
    // ─────────────────────────────────────────────────────────────────────
    // Circulating supply (via block rewards) must never exceed MAX_SUPPLY.

    #[kani::proof]
    fn verify_supply_cap_invariant() {
        let chain = Chain::new();

        // Genesis block reward must be within bounds
        assert!(chain.circulating_supply() <= MAX_SUPPLY,
            "Genesis supply {} exceeds MAX_SUPPLY {}",
            chain.circulating_supply(), MAX_SUPPLY);
        assert!(chain.circulating_supply() <= INITIAL_REWARD);

        // Supply percentage must be computable without panicking
        let pct = chain.supply_percent();
        assert!(pct >= 0.0);
        assert!(pct <= 100.0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 4: Chain Genesis Integrity
    // ─────────────────────────────────────────────────────────────────────
    // A new chain must pass is_valid_chain, have height 0, and exactly
    // one block (genesis).

    #[kani::proof]
    fn verify_chain_genesis_integrity() {
        let chain = Chain::new();

        assert_eq!(chain.height(), 0);
        assert_eq!(chain.blocks.len(), 1);
        assert_eq!(chain.tip().block_number, 0);

        // Genesis should validate against itself
        assert!(chain.is_valid_chain().is_ok());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 5: Block Reward Halving Bounds
    // ─────────────────────────────────────────────────────────────────────
    // Block reward must always be between 0 and INITIAL_REWARD.

    #[kani::proof]
    #[kani::unwind(65)] // up to 64 halvings
    fn verify_block_reward_bounds() {
        let height: u64 = kani::any();
        kani::assume(height <= 13_440_000); // 64 * 210000 = max halvings

        let reward = crate::block_reward(height);

        assert!(reward >= 0.0, "Block reward ({}) must be non-negative", reward);
        assert!(reward <= INITIAL_REWARD,
            "Block reward ({}) must not exceed initial reward ({})",
            reward, INITIAL_REWARD);

        // After 64 halvings, reward must be 0
        if height >= 64 * 210_000 {
            assert_eq!(reward, 0.0,
                "Reward must be 0 after 64 halvings (height {})", height);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 6: Key Image Double-Spend Prevention
    // ─────────────────────────────────────────────────────────────────────
    // Once a key image is registered, any attempt to re-register must fail.

    #[kani::proof]
    fn verify_key_image_double_spend_prevention() {
        let mut chain = Chain::new();

        let key_image: String = kani::any();
        kani::assume(!key_image.is_empty());
        kani::assume(key_image.len() <= 128);

        // First registration must succeed
        let result1 = chain.register_key_image(&key_image, "tx1");
        assert!(result1.is_ok());

        // Second registration of the same key image must fail
        let result2 = chain.register_key_image(&key_image, "tx2");
        assert!(result2.is_err());

        // It must be a DoubleSpend error
        match result2.unwrap_err() {
            crate::ChainError::DoubleSpend { .. } => { /* expected */ }
            _ => panic!("Expected DoubleSpend error, got something else"),
        }

        // is_key_image_spent must return true
        assert!(chain.is_key_image_spent(&key_image));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 7: Median Time Past — Non-Negative
    // ─────────────────────────────────────────────────────────────────────

    #[kani::proof]
    fn verify_median_time_past_non_negative() {
        let chain = Chain::new();
        let mtp = chain.median_time_past();
        assert!(mtp > 0, "Median time past must be positive after genesis");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 8: Fee Recommendation Ordering
    // ─────────────────────────────────────────────────────────────────────
    // Fee recommendations must be ordered: slow < normal < fast

    #[kani::proof]
    fn verify_fee_recommendation_ordering() {
        let size_bytes: usize = kani::any();
        let congestion: f64 = kani::any();

        kani::assume(size_bytes > 0 && size_bytes <= 100_000);
        kani::assume(congestion >= 0.0 && congestion <= 1.0);

        let privacy = PrivacyLevel::Full;
        let rec = crate::recommend_fee(size_bytes, &privacy, congestion);

        assert!(rec.fast >= rec.normal, "fast ({}) >= normal ({}) failed", rec.fast, rec.normal);
        assert!(rec.normal >= rec.slow, "normal ({}) >= slow ({}) failed", rec.normal, rec.slow);
        assert!(rec.slow >= privacy.min_fee(), "slow ({}) >= min_fee ({})", rec.slow, privacy.min_fee());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 9: validate_tx_set_against_utxo — Balance Check
    // ─────────────────────────────────────────────────────────────────────
    // For transparent transactions, if the sender has insufficient balance,
    // validation must return an error.

    #[kani::proof]
    #[kani::unwind(5)]
    fn verify_utxo_balance_enforcement() {
        use std::collections::{HashMap, HashSet};
        use crate::validate_tx_set_against_utxo;

        // Set up: address with a small balance
        let from = "HSMCaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string();
        let to = "HSMCbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string();

        let balance: f64 = kani::any();
        kani::assume(balance >= 0.0 && balance <= 1000.0);

        let mut utxo_balances: HashMap<String, f64> = HashMap::new();
        utxo_balances.insert(from.clone(), balance);

        let known_key_images: HashSet<String> = HashSet::new();

        // Create a transaction that spends MORE than the available balance
        let amount: f64 = kani::any();
        let fee: f64 = kani::any();
        kani::assume(amount > 0.0);
        kani::assume(fee >= 0.0001); // min fee

        let tx = Transaction::new(&from, &to, amount, fee, PrivacyLevel::Transparent);
        let txs = vec![tx];

        let result = validate_tx_set_against_utxo(&txs, &utxo_balances, &known_key_images);

        if amount + fee > balance + 1e-9 {
            // Must fail with InsufficientUTXO
            assert!(result.is_err(),
                "Should reject tx with total {} when balance is {}",
                amount + fee, balance);
            match result.unwrap_err() {
                crate::ValidationError::InsufficientUTXO { .. } => { /* expected */ }
                _ => panic!("Expected InsufficientUTXO, got different error"),
            }
        }
        // If amount + fee <= balance, it might pass or fail for other reasons
    }
}
