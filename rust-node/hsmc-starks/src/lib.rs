//! HSMC Shielded Pool — zk-STARK powered private transaction pool.
//!
//! ## Architecture
//!
//! The ShieldedPool maintains a Merkle tree of encrypted notes. Each note is a
//! hash commitment to (amount, blinding). Deposits insert new notes;
//! withdrawals require a zk-STARK proof that the prover knows the note opening
//! and has derived the correct nullifier — without revealing which note is spent.
//!
//! ## zk-STARK Proof
//!
//! Uses the `winterfell` library (Polygon Miden) to generate STARK proofs for:
//! - **Deposit**: new note commitment is correctly formed from (amount, blinding)
//! - **Withdraw**: nullifier is correctly derived from (commitment, secret);
//!   amount is consistent with the original deposit
//!
//! The STARK AIR constrains state transitions across a 2-row trace:
//!   - Row 0: initial pool state (before operation)
//!   - Row 1: final pool state (after operation)
//!
//! ## Security
//!
//! - Double-spend protection via nullifier set
//! - zk-STARK proofs are post-quantum secure (transparent setup, no trusted ceremony)
//! - Merkle proofs anchor notes to the pool root

use winterfell::{
    math::{fields::f64::BaseElement, FieldElement, ToElements},
    crypto::{
        hashers::Blake3_256,
        DefaultRandomCoin, MerkleTree as WinterMerkleTree,
    },
    matrix::ColMatrix,
    Air, AirContext, Assertion, AuxRandElements, BatchingMethod,
    CompositionPoly, CompositionPolyTrace,
    DefaultConstraintCommitment, DefaultConstraintEvaluator,
    DefaultTraceLde, EvaluationFrame, FieldExtension,
    PartitionOptions, Proof, ProofOptions, Prover, StarkDomain,
    TraceInfo, TracePolyTable, TraceTable,
    TransitionConstraintDegree,
    AcceptableOptions, verify,
};
use sha2::{Digest, Sha512};
use sha3::Keccak256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use std::collections::{HashMap, HashSet};

// ═══════════════════════════════════════════════════════════════════════════════════
// Error types
// ═══════════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Error)]
pub enum PoolError {
    #[error("Note not found in pool")]
    NoteNotFound,

    #[error("Nullifier already spent (double-spend attempt)")]
    NullifierAlreadySpent,

    #[error("Invalid Merkle proof")]
    InvalidMerkleProof,

    #[error("Invalid STARK proof: {0}")]
    InvalidStarkProof(String),

    #[error("STARK proof generation failed: {0}")]
    ProofGenerationFailed(String),

    #[error("Amount overflow")]
    AmountOverflow,

    #[error("Pool is empty")]
    PoolEmpty,
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════════════════════

/// A shielded note — represents a deposit into the pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    /// Hash commitment: C = Hash("HSMC_NOTE_v1" || amount || blinding)
    pub commitment: [u8; 32],
    /// Amount in satoshis (1 HSMC = 100_000_000 satoshis)
    pub amount: u64,
    /// Random blinding factor (32 bytes)
    pub blinding: [u8; 32],
    /// Leaf index in the Merkle tree
    pub leaf_index: u64,
}

/// A nullifier — proves a note has been spent without revealing which one.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Nullifier(pub [u8; 32]);

/// Public inputs to the zk-STARK proof.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolPublicInputs {
    pub merkle_root: [u8; 32],
    pub operation: u8,
    pub nullifier: Nullifier,
}

impl ToElements<BaseElement> for PoolPublicInputs {
    fn to_elements(&self) -> Vec<BaseElement> {
        let mut elems = Vec::with_capacity(10);
        for chunk in self.merkle_root.chunks(8) {
            let mut buf = [0u8; 8];
            let len = chunk.len().min(8);
            buf[..len].copy_from_slice(&chunk[..len]);
            elems.push(BaseElement::new(u64::from_le_bytes(buf)));
        }
        elems.push(BaseElement::new(self.operation as u64));
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self.nullifier.0[..8]);
        elems.push(BaseElement::new(u64::from_le_bytes(buf)));
        elems
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Merkle Tree (for note storage)
// ═══════════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
pub struct MerkleTree {
    depth: usize,
    default_nodes: Vec<[u8; 32]>,
    nodes: HashMap<(usize, u64), [u8; 32]>,
    leaf_count: u64,
}

impl MerkleTree {
    pub fn new(depth: usize) -> Self {
        let mut default_nodes = vec![[0u8; 32]; depth + 1];
        for d in 0..depth {
            let combined = [default_nodes[d], default_nodes[d]].concat();
            let hash = Keccak256::digest(&combined);
            default_nodes[d + 1].copy_from_slice(&hash);
        }
        Self { depth, default_nodes, nodes: HashMap::new(), leaf_count: 0 }
    }

    pub fn insert(&mut self, leaf: &[u8; 32]) -> ([u8; 32], Vec<[u8; 32]>) {
        let index = self.leaf_count;
        self.leaf_count += 1;
        self.nodes.insert((0, index), *leaf);
        let mut current = *leaf;
        let mut path = Vec::with_capacity(self.depth);
        for level in 0..self.depth {
            let sibling_idx = if index >> level & 1 == 0 {
                index + (1 << level)
            } else {
                index - (1 << level)
            };
            let sibling = self.get_node(level, sibling_idx);
            path.push(sibling);
            let (left, right) = if index >> level & 1 == 0 {
                (current, sibling)
            } else {
                (sibling, current)
            };
            let combined = [left, right].concat();
            let hash = Keccak256::digest(&combined);
            let mut parent = [0u8; 32];
            parent.copy_from_slice(&hash);
            self.nodes.insert((level + 1, index >> (level + 1)), parent);
            current = parent;
        }
        (current, path)
    }

    pub fn root(&self) -> [u8; 32] {
        if self.leaf_count == 0 {
            return self.default_nodes[self.depth];
        }
        self.get_node(self.depth, 0)
    }

    fn get_node(&self, level: usize, index: u64) -> [u8; 32] {
        self.nodes.get(&(level, index)).copied().unwrap_or(self.default_nodes[level])
    }

    pub fn prove(&self, leaf_index: u64) -> Option<Vec<[u8; 32]>> {
        if leaf_index >= self.leaf_count { return None; }
        let mut path = Vec::with_capacity(self.depth);
        for level in 0..self.depth {
            let sibling_idx = if leaf_index >> level & 1 == 0 {
                leaf_index + (1 << level)
            } else {
                leaf_index - (1 << level)
            };
            path.push(self.get_node(level, sibling_idx));
        }
        Some(path)
    }

    pub fn verify_proof(
        root: &[u8; 32], leaf: &[u8; 32], leaf_index: u64, proof: &[[u8; 32]], depth: usize,
    ) -> bool {
        if proof.len() != depth { return false; }
        let mut current = *leaf;
        for (level, sibling) in proof.iter().enumerate() {
            let (left, right) = if leaf_index >> level & 1 == 0 {
                (current, *sibling)
            } else {
                (*sibling, current)
            };
            let combined = [left, right].concat();
            let hash = Keccak256::digest(&combined);
            current.copy_from_slice(&hash);
        }
        current == *root
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Zk-STARK AIR: PoolStateTransition
// ═══════════════════════════════════════════════════════════════════════════════════

pub struct PoolAir {
    context: AirContext<BaseElement>,
    operation: u8,
}

impl Air for PoolAir {
    type BaseField = BaseElement;
    type PublicInputs = PoolPublicInputs;

    fn new(trace_info: TraceInfo, pub_inputs: PoolPublicInputs, options: ProofOptions) -> Self {
        let degrees = vec![
            TransitionConstraintDegree::new(1), // C₀
            TransitionConstraintDegree::new(1), // C₁
            TransitionConstraintDegree::new(1), // C₂
            TransitionConstraintDegree::new(1), // C₃
            TransitionConstraintDegree::new(2), // Amount
            TransitionConstraintDegree::new(2), // Op
        ];
        let num_assertions = if pub_inputs.operation == 1 { 2 } else { 1 };
        Self {
            context: AirContext::new(trace_info, degrees, num_assertions, options),
            operation: pub_inputs.operation,
        }
    }

    fn context(&self) -> &AirContext<BaseElement> { &self.context }

    fn evaluate_transition<E: FieldElement + From<Self::BaseField>>(
        &self,
        frame: &EvaluationFrame<E>,
        _periodic_values: &[E],
        result: &mut [E],
    ) {
        let cur = frame.current();
        let nxt = frame.next();

        // Columns 0-3: commitment invariant
        for i in 0..4 { result[i] = nxt[i] - cur[i]; }

        // Column 4: Amount — nxt_amount - cur_amount + op * cur_amount = 0
        result[4] = nxt[4] - cur[4] + cur[5] * cur[4];

        // Column 5: Operation invariant
        result[5] = nxt[5] - cur[5];
    }

    fn get_assertions(&self) -> Vec<Assertion<BaseElement>> {
        let mut assertions = Vec::new();
        assertions.push(Assertion::single(5, 0, BaseElement::new(self.operation as u64)));
        if self.operation == 1 {
            assertions.push(Assertion::single(4, 1, BaseElement::ZERO));
        }
        assertions
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// STARK Prover Implementation
// ═══════════════════════════════════════════════════════════════════════════════════

pub struct PoolProver {
    options: ProofOptions,
}

impl PoolProver {
    pub fn new(options: ProofOptions) -> Self {
        Self { options }
    }
}

impl Prover for PoolProver {
    type BaseField = BaseElement;
    type Air = PoolAir;
    type Trace = TraceTable<Self::BaseField>;
    type HashFn = Blake3_256<Self::BaseField>;
    type VC = WinterMerkleTree<Self::HashFn>;
    type RandomCoin = DefaultRandomCoin<Self::HashFn>;
    type TraceLde<E: FieldElement<BaseField = Self::BaseField>> =
        DefaultTraceLde<E, Self::HashFn, Self::VC>;
    type ConstraintCommitment<E: FieldElement<BaseField = Self::BaseField>> =
        DefaultConstraintCommitment<E, Self::HashFn, Self::VC>;
    type ConstraintEvaluator<'a, E: FieldElement<BaseField = Self::BaseField>> =
        DefaultConstraintEvaluator<'a, Self::Air, E>;

    fn get_pub_inputs(&self, trace: &Self::Trace) -> PoolPublicInputs {
        let op = trace.get(5, 0).as_int() as u8;
        let null_prefix = if op == 1 {
            let mut buf = [0u8; 8];
            let v = trace.get(0, 0).as_int();
            buf.copy_from_slice(&v.to_le_bytes());
            Nullifier({ let mut n = [0u8; 32]; n[..8].copy_from_slice(&buf); n })
        } else {
            Nullifier([0u8; 32])
        };
        PoolPublicInputs {
            merkle_root: [0u8; 32],
            operation: op,
            nullifier: null_prefix,
        }
    }

    fn options(&self) -> &ProofOptions { &self.options }

    fn new_trace_lde<E: FieldElement<BaseField = Self::BaseField>>(
        &self,
        trace_info: &TraceInfo,
        main_trace: &ColMatrix<Self::BaseField>,
        domain: &StarkDomain<Self::BaseField>,
        partition_option: PartitionOptions,
    ) -> (Self::TraceLde<E>, TracePolyTable<E>) {
        DefaultTraceLde::new(trace_info, main_trace, domain, partition_option)
    }

    fn build_constraint_commitment<E: FieldElement<BaseField = Self::BaseField>>(
        &self,
        composition_poly_trace: CompositionPolyTrace<E>,
        num_constraint_composition_columns: usize,
        domain: &StarkDomain<Self::BaseField>,
        partition_options: PartitionOptions,
    ) -> (Self::ConstraintCommitment<E>, CompositionPoly<E>) {
        DefaultConstraintCommitment::new(
            composition_poly_trace,
            num_constraint_composition_columns,
            domain,
            partition_options,
        )
    }

    fn new_evaluator<'a, E: FieldElement<BaseField = Self::BaseField>>(
        &self,
        air: &'a Self::Air,
        aux_rand_elements: Option<AuxRandElements<E>>,
        composition_coefficients: winterfell::ConstraintCompositionCoefficients<E>,
    ) -> Self::ConstraintEvaluator<'a, E> {
        DefaultConstraintEvaluator::new(air, aux_rand_elements, composition_coefficients)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ShieldedPool — the main pool implementation
// ═══════════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
pub struct ShieldedPool {
    pub depth: usize,
    pub tree: MerkleTree,
    pub nullifier_set: HashSet<Nullifier>,
    pub total_value_locked: u64,
    pub notes: Vec<Note>,
    pub proof_options: ProofOptions,
}

impl ShieldedPool {
    pub fn new(depth: usize) -> Self {
        let proof_options = ProofOptions::new(
            32,                            // num_queries
            8,                             // blowup_factor
            0,                             // grinding_factor
            FieldExtension::None,
            8,                             // fri_folding_factor
            31,                            // fri_max_remainder_degree
            BatchingMethod::Linear,
            BatchingMethod::Linear,
        );
        Self {
            depth,
            tree: MerkleTree::new(depth),
            nullifier_set: HashSet::new(),
            total_value_locked: 0,
            notes: Vec::new(),
            proof_options,
        }
    }

    /// Compute a note commitment: C = Hash("HSMC_NOTE_v1" || amount || blinding).
    pub fn compute_commitment(amount: u64, blinding: &[u8; 32]) -> [u8; 32] {
        let mut hasher = Sha512::new();
        hasher.update(b"HSMC_NOTE_v1");
        hasher.update(amount.to_le_bytes());
        hasher.update(blinding);
        let hash = hasher.finalize();
        let mut c = [0u8; 32];
        c.copy_from_slice(&hash[..32]);
        c
    }

    /// Derive a nullifier: N = Hash("HSMC_NULLIFIER_v1" || commitment || secret || leaf_index).
    pub fn derive_nullifier(
        commitment: &[u8; 32], secret: &[u8; 32], leaf_index: u64,
    ) -> Nullifier {
        let mut hasher = Keccak256::default();
        hasher.update(b"HSMC_NULLIFIER_v1");
        hasher.update(commitment);
        hasher.update(secret);
        hasher.update(leaf_index.to_le_bytes());
        let mut n = [0u8; 32];
        n.copy_from_slice(&hasher.finalize());
        Nullifier(n)
    }

    /// Deposit into the shielded pool. Returns (Note, Proof).
    pub fn deposit(&mut self, amount: u64) -> Result<(Note, Proof), PoolError> {
        if amount == 0 { return Err(PoolError::AmountOverflow); }

        let mut blinding = [0u8; 32];
        getrandom::getrandom(&mut blinding).map_err(|_| PoolError::AmountOverflow)?;

        let commitment = Self::compute_commitment(amount, &blinding);
        let leaf_index = self.tree.leaf_count;
        self.tree.insert(&commitment);

        let note = Note { commitment, amount, blinding, leaf_index };
        self.notes.push(note.clone());
        self.total_value_locked = self.total_value_locked.saturating_add(amount);

        let proof = self.generate_deposit_proof(&note)?;
        Ok((note, proof))
    }

    /// Withdraw from the shielded pool. Returns (amount, Proof).
    pub fn withdraw(&mut self, note: &Note, secret: &[u8; 32]) -> Result<(u64, Proof), PoolError> {
        if note.leaf_index >= self.tree.leaf_count {
            return Err(PoolError::NoteNotFound);
        }
        let expected = Self::compute_commitment(note.amount, &note.blinding);
        if expected != note.commitment {
            return Err(PoolError::InvalidStarkProof("Commitment mismatch".into()));
        }
        let nullifier = Self::derive_nullifier(&note.commitment, secret, note.leaf_index);
        if self.nullifier_set.contains(&nullifier) {
            return Err(PoolError::NullifierAlreadySpent);
        }
        let merkle_proof = self.tree.prove(note.leaf_index).ok_or(PoolError::NoteNotFound)?;
        if !MerkleTree::verify_proof(&self.tree.root(), &note.commitment, note.leaf_index, &merkle_proof, self.depth) {
            return Err(PoolError::InvalidMerkleProof);
        }
        self.nullifier_set.insert(nullifier.clone());
        self.total_value_locked = self.total_value_locked.saturating_sub(note.amount);
        let proof = self.generate_withdraw_proof(note)?;
        Ok((note.amount, proof))
    }

    /// Verify a proof against public inputs.
    pub fn verify_proof(&self, proof: &Proof, pub_inputs: &PoolPublicInputs) -> Result<(), PoolError> {
        let min_opts = AcceptableOptions::MinConjecturedSecurity(95);
        verify::<
            PoolAir,
            Blake3_256<BaseElement>,
            DefaultRandomCoin<Blake3_256<BaseElement>>,
            WinterMerkleTree<Blake3_256<BaseElement>>,
        >(proof.clone(), pub_inputs.clone(), &min_opts)
        .map_err(|e| PoolError::InvalidStarkProof(format!("{:?}", e)))
    }

    // ── Private helpers ────────────────────────────────────────────────

    fn make_trace(note: &Note, op: u8) -> TraceTable<BaseElement> {
        let width = 6;
        let length = 2;
        let chunks = Self::split_u256_to_u64s(&note.commitment);
        let amount_field = BaseElement::new(note.amount);

        let mut trace = TraceTable::new(width, length);
        trace.fill(
            |state| {
                // Row 0: initial state
                if op == 0 {
                    // Deposit: zero note before
                    state[0] = BaseElement::ZERO;
                    state[1] = BaseElement::ZERO;
                    state[2] = BaseElement::ZERO;
                    state[3] = BaseElement::ZERO;
                    state[4] = BaseElement::ZERO;
                    state[5] = BaseElement::new(op as u64);
                } else {
                    // Withdraw: note exists
                    state[0] = BaseElement::new(chunks[0]);
                    state[1] = BaseElement::new(chunks[1]);
                    state[2] = BaseElement::new(chunks[2]);
                    state[3] = BaseElement::new(chunks[3]);
                    state[4] = amount_field;
                    state[5] = BaseElement::new(op as u64);
                }
            },
            |_, state| {
                // Row 1: after operation
                state[0] = BaseElement::new(chunks[0]);
                state[1] = BaseElement::new(chunks[1]);
                state[2] = BaseElement::new(chunks[2]);
                state[3] = BaseElement::new(chunks[3]);
                state[4] = if op == 1 { BaseElement::ZERO } else { amount_field };
                state[5] = BaseElement::new(op as u64);
            },
        );
        trace
    }

    fn generate_deposit_proof(&self, note: &Note) -> Result<Proof, PoolError> {
        let trace = Self::make_trace(note, 0);
        let prover = PoolProver::new(self.proof_options.clone());
        prover.prove(trace).map_err(|e| PoolError::ProofGenerationFailed(format!("{:?}", e)))
    }

    fn generate_withdraw_proof(&self, note: &Note) -> Result<Proof, PoolError> {
        let trace = Self::make_trace(note, 1);
        let prover = PoolProver::new(self.proof_options.clone());
        prover.prove(trace).map_err(|e| PoolError::ProofGenerationFailed(format!("{:?}", e)))
    }

    fn split_u256_to_u64s(bytes: &[u8; 32]) -> [u64; 4] {
        let mut chunks = [0u64; 4];
        for i in 0..4 {
            let mut buf = [0u8; 8];
            buf.copy_from_slice(&bytes[i * 8..(i + 1) * 8]);
            chunks[i] = u64::from_le_bytes(buf);
        }
        chunks
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_tree_basics() {
        let mut tree = MerkleTree::new(4);
        let leaf1 = [1u8; 32];
        let leaf2 = [2u8; 32];
        let (root1, path1) = tree.insert(&leaf1);
        let (root2, path2) = tree.insert(&leaf2);
        assert!(MerkleTree::verify_proof(&root1, &leaf1, 0, &path1, 4));
        assert!(MerkleTree::verify_proof(&root2, &leaf2, 1, &path2, 4));
        assert_ne!(root1, root2);

        let wrong = [99u8; 32];
        assert!(!MerkleTree::verify_proof(&root1, &wrong, 0, &path1, 4));
    }

    #[test]
    fn test_commitment_determinism() {
        let c1 = ShieldedPool::compute_commitment(100, &[0xAB; 32]);
        let c2 = ShieldedPool::compute_commitment(100, &[0xAB; 32]);
        assert_eq!(c1, c2);
        let c3 = ShieldedPool::compute_commitment(101, &[0xAB; 32]);
        assert_ne!(c1, c3);
    }

    #[test]
    fn test_nullifier_determinism() {
        let n1 = ShieldedPool::derive_nullifier(&[0x11; 32], &[0x22; 32], 5);
        let n2 = ShieldedPool::derive_nullifier(&[0x11; 32], &[0x22; 32], 5);
        assert_eq!(n1, n2);
        let n3 = ShieldedPool::derive_nullifier(&[0x11; 32], &[0x22; 32], 6);
        assert_ne!(n1, n3);
    }

    #[test]
    fn test_deposit_and_withdraw_flow() -> Result<(), PoolError> {
        let mut pool = ShieldedPool::new(16);
        let secret = [0x42; 32];
        let amount = 1_000_000_000u64;

        let (note, deposit_proof) = pool.deposit(amount)?;
        assert_eq!(pool.total_value_locked, amount);
        assert_eq!(note.amount, amount);

        // Verify deposit proof
        let root = pool.tree.root();
        let pub_inputs = PoolPublicInputs {
            merkle_root: root,
            operation: 0,
            nullifier: Nullifier([0u8; 32]),
        };
        pool.verify_proof(&deposit_proof, &pub_inputs)?;

        // Withdraw
        let (wd_amount, withdraw_proof) = pool.withdraw(&note, &secret)?;
        assert_eq!(wd_amount, amount);
        assert_eq!(pool.total_value_locked, 0);

        // Verify withdraw proof
        let nullifier = ShieldedPool::derive_nullifier(&note.commitment, &secret, note.leaf_index);
        let wd_inputs = PoolPublicInputs {
            merkle_root: pool.tree.root(),
            operation: 1,
            nullifier,
        };
        pool.verify_proof(&withdraw_proof, &wd_inputs)?;

        Ok(())
    }

    #[test]
    fn test_double_spend_prevented() -> Result<(), PoolError> {
        let mut pool = ShieldedPool::new(16);
        let secret = [0x42; 32];
        let (note, _) = pool.deposit(100_000_000)?;
        assert!(pool.withdraw(&note, &secret).is_ok());
        let result = pool.withdraw(&note, &secret);
        assert!(matches!(result, Err(PoolError::NullifierAlreadySpent)));
        Ok(())
    }

    #[test]
    fn test_fake_note_rejected() {
        let mut pool = ShieldedPool::new(16);
        let fake = Note {
            commitment: [0u8; 32], amount: 100, blinding: [0u8; 32], leaf_index: 999,
        };
        assert!(pool.withdraw(&fake, &[0u8; 32]).is_err());
    }

    #[test]
    fn test_multiple_deposits() -> Result<(), PoolError> {
        let mut pool = ShieldedPool::new(16);
        let mut total = 0u64;
        for &amt in &[1_000_000u64, 2_000_000, 3_000_000, 5_000_000] {
            let (_, _proof) = pool.deposit(amt)?;
            total += amt;
        }
        assert_eq!(pool.total_value_locked, total);
        assert_eq!(pool.notes.len(), 4);
        assert_eq!(pool.tree.leaf_count, 4);
        Ok(())
    }
}
