---- MODULE consensus_safety ----
\* ============================================================================
\* HSMC Consensus Safety — Formal TLA+ Specification
\* ============================================================================
\* Verifies: at most one block at any given height on the canonical chain.
\*
\* Safety property (invariant):
\*   \A i, j \in DOMAIN chain :
\*     (i /= j) => chain[i].block_number /= chain[j].block_number
\*
\* Equivalent to: no two distinct positions in the chain vector have the same
\* block height. This prevents chain forks from being accepted into the
\* canonical chain — the chain remains a simple, linear sequence.
\*
\* The Chain struct in rust-node/hsmc-core/src/chain.rs maintains this by:
\*   1. `add_block`: rejects duplicate block_number via the hash_index check
\*   2. `try_reorg`: common-ancestor arbitration; only switches if more work
\*   3. `is_valid_chain`: validates block_number == prev.block_number + 1
\*
\* This spec models a simplified PoW chain with heaviest-chain selection.
\* ============================================================================

EXTENDS Naturals, Sequences, FiniteSets, TLC

\* ── Constants ───────────────────────────────────────────────────────────────
CONSTANTS
    MAX_BLOCKS,       \* Max blocks to model (bound for finite state space)
    MinerCount         \* Number of competing miners

ASSUME MAX_BLOCKS > 0
ASSUME MinerCount > 0

\* ── Variables ───────────────────────────────────────────────────────────────
VARIABLES
    chain,             \* Seq([height: Nat, hash: Nat, prev_hash: Nat, work: Nat])
    orphan_pool,       \* Set of blocks waiting for parent
    next_hash          \* Monotonically increasing hash counter (simplified PoW)

vars == <<chain, orphan_pool, next_hash>>

\* ── Helper Operators ────────────────────────────────────────────────────────

\* A block is a tuple: <<height, hash, prev_hash, work>>
BlockFields(h, hash, prev, work) == <<h, hash, prev, work>>

Height(b)   == b[1]
Hash(b)     == b[2]
PrevHash(b) == b[3]
Work(b)     == b[4]

\* Chain height: last block's height (0 for empty chain)
ChainHeight ==
    IF chain = <<>> THEN 0
    ELSE Height(chain[Len(chain)])

\* Tip hash: hash of the last block (0 for empty chain)
TipHash ==
    IF chain = <<>> THEN 0
    ELSE Hash(chain[Len(chain)])

\* Block height uniqueness: no two positions in chain have the same height
HeightsUnique ==
    \A i, j \in 1..Len(chain) :
        (i /= j) => Height(chain[i]) /= Height(chain[j])

\* Chain is contiguous: each block links to the previous
ChainContiguous ==
    \A i \in 2..Len(chain) :
        PrevHash(chain[i]) = Hash(chain[i-1])

\* Chain is monotonic: block heights increase by 1
ChainMonotonic ==
    \A i \in 2..Len(chain) :
        Height(chain[i]) = Height(chain[i-1]) + 1

\* Total chain work (sum of all block work values)
TotalWork ==
    LET sum_work(seq, n) ==
        IF n = 0 THEN 0
        ELSE sum_work(seq, n-1) + Work(seq[n])
    IN sum_work(chain, Len(chain))

\* Find block by hash in chain
BlockInChain(hash) ==
    \E i \in 1..Len(chain) : Hash(chain[i]) = hash

\* ── Initial State ───────────────────────────────────────────────────────────
Init ==
    /\ chain = << >>
    /\ orphan_pool = {}
    /\ next_hash = 0

\* ── Actions ─────────────────────────────────────────────────────────────────

\* Extend the chain: miner finds a valid block extending the current tip
MineBlock ==
    LET h == ChainHeight + 1
        prev == TipHash
        hash == next_hash
        work == 1     \* Simplified: each block contributes 1 unit of work
        new_block == BlockFields(h, hash, prev, work)
    IN
    /\ Len(chain) < MAX_BLOCKS
    /\ chain' = Append(chain, new_block)
    /\ orphan_pool' = orphan_pool
    /\ next_hash' = next_hash + 1

\* A competing fork block arrives (for a non-tip parent)
\* In HSMC: orphan blocks are stored and processed when parent arrives
ReceiveOrphan ==
    LET h == ChainHeight + 2        \* Skips one height (fork)
        prev == TipHash
        hash == next_hash
        work == 1
        new_block == BlockFields(h, hash, prev, work)
    IN
    /\ Len(chain) < MAX_BLOCKS
    /\ chain' = chain
    /\ orphan_pool' = orphan_pool \cup {new_block}
    /\ next_hash' = next_hash + 1

\* Resolve orphan: orphan's parent became available, add it as alternative
\* In HSMC's Chain::try_reorg: if orphan fork has more work, it wins
ResolveOrphan ==
    \E b \in orphan_pool :
        LET fork_tip == b
            fork_work == Work(b)
            current_work == TotalWork
        IN
        \* Can only resolve if orphan extends a block we have
        /\ BlockInChain(PrevHash(b))
        \* Only accept if orphan fork has strictly more work (heaviest-chain rule)
        /\ fork_work > current_work
        \* Find common ancestor and truncate chain to that point, then append
        /\ \E idx \in 1..Len(chain) :
            LET common_hash == Hash(chain[idx])
            IN common_hash = PrevHash(b)
               /\ chain' = SubSeq(chain, 1, idx) \o <<b>>
        /\ orphan_pool' = orphan_pool \ {b}
        /\ next_hash' = next_hash

\* Next-state relation
Next ==
    \/ MineBlock
    \/ ReceiveOrphan
    \/ ResolveOrphan

\* ── Safety Invariants ───────────────────────────────────────────────────────

\* **Primary safety invariant**: at most one block at each height
NoTwoBlocksAtSameHeight ==
    HeightsUnique

\* Chain is properly linked (prev_hash references are valid)
ChainLinkageInvariant ==
    ChainContiguous

\* Block heights increment by exactly 1 (no gaps)
NoHeightGaps ==
    IF Len(chain) <= 1 THEN TRUE
    ELSE ChainMonotonic

\* All block heights are within bounds
HeightBounds ==
    \A i \in 1..Len(chain) :
        Height(chain[i]) >= 1 /\ Height(chain[i]) <= MAX_BLOCKS

\* No block hash is repeated
NoDuplicateHashes ==
    \A i, j \in 1..Len(chain) :
        (i /= j) => Hash(chain[i]) /= Hash(chain[j])

\* Combined safety invariant
ConsensusSafety ==
    /\ NoTwoBlocksAtSameHeight
    /\ ChainLinkageInvariant
    /\ NoHeightGaps
    /\ NoDuplicateHashes

\* ── Theorem ─────────────────────────────────────────────────────────────────
THEOREM SafetyHolds ==
    Init => []ConsensusSafety

\* ── TLC Configuration ───────────────────────────────────────────────────────
\* SPECIFICATION Spec
\* CONSTANTS
\*   MAX_BLOCKS = 5
\*   MinerCount = 2
\* INVARIANTS
\*   NoTwoBlocksAtSameHeight
\*   ChainLinkageInvariant
\*   NoHeightGaps
\*   NoDuplicateHashes

=============================================================================
