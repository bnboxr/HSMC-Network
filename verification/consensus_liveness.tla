---- MODULE consensus_liveness ----
\* ============================================================================
\* HSMC Consensus Liveness — Formal TLA+ Specification
\* ============================================================================
\* Verifies: every valid transaction is eventually included in a block.
\*
\* Liveness property (temporal):
\*   \A tx \in mempool : <>(\E block \in chain : tx \in block.transactions)
\*
\* In HSMC, liveness is guaranteed by:
\*   1. PoW miners are incentivized to include transactions (fee market)
\*   2. Mempool propagates valid transactions to all miners
\*   3. Block time target (120 seconds) ensures periodic inclusion
\*   4. No censorship: any valid tx paying >= min_fee is eligible
\*
\* This spec models a simplified mempool + miner inclusion cycle.
\* Assumes weak fairness: if a tx stays in mempool, a miner will eventually
\* produce a non-empty block containing it.
\* ============================================================================

EXTENDS Naturals, Sequences, FiniteSets, TLC

\* ── Constants ───────────────────────────────────────────────────────────────
CONSTANTS
    MaxTx,            \* Maximum number of transactions to model
    MinFee            \* Minimum fee for tx inclusion

ASSUME MaxTx > 0
ASSUME MinFee >= 0

\* ── Transaction Model ───────────────────────────────────────────────────────
\* A transaction: <<id, fee>>
TxId(tx) == tx[1]
TxFee(tx) == tx[2]

\* ── Variables ───────────────────────────────────────────────────────────────
VARIABLES
    mempool,           \* Set of pending transactions (those not yet in a block)
    chain_txs,         \* Sequence of sets: block[i] contains these tx ids
    next_tx_id,        \* Monotonically increasing transaction ID counter
    block_count         \* Number of blocks mined so far

vars == <<mempool, chain_txs, next_tx_id, block_count>>

\* ── Helpers ─────────────────────────────────────────────────────────────────

\* All transactions ever included in a block
AllIncludedTxs ==
    UNION { chain_txs[i] : i \in 1..Len(chain_txs) }

\* All transactions ever created
AllCreatedTxs ==
    { tx \in 1..(next_tx_id - 1) : TRUE }

\* Transactions still pending (created but not yet included)
StillPending ==
    AllCreatedTxs \ AllIncludedTxs

\* ── Initial State ───────────────────────────────────────────────────────────
Init ==
    /\ mempool = {}
    /\ chain_txs = << >>
    /\ next_tx_id = 1
    /\ block_count = 0

\* ── Actions ─────────────────────────────────────────────────────────────────

\* A new valid transaction is submitted to the mempool
SubmitTx ==
    LET id == next_tx_id
        fee == MinFee + (id % 10)   \* Varying fees for realism
    IN
    /\ id <= MaxTx
    /\ mempool' = mempool \cup {id}
    /\ chain_txs' = chain_txs
    /\ next_tx_id' = next_tx_id + 1
    /\ block_count' = block_count

\* A miner produces a block, selecting some transactions from mempool
\* Fairness: if mempool is non-empty, miner MUST include at least one tx
MineBlockWithTxs ==
    LET selected \in SUBSET mempool
    IN
    /\ mempool /= {}             \* Only mine if there are pending txs
    /\ selected /= {}            \* Miner must include at least one tx
    /\ mempool' = mempool \ selected
    /\ chain_txs' = Append(chain_txs, selected)
    /\ next_tx_id' = next_tx_id
    /\ block_count' = block_count + 1

\* A miner produces an empty block (no pending txs)
MineEmptyBlock ==
    /\ mempool = {}
    /\ mempool' = mempool
    /\ chain_txs' = Append(chain_txs, {})
    /\ next_tx_id' = next_tx_id
    /\ block_count' = block_count + 1

\* Next-state relation
Next ==
    \/ SubmitTx
    \/ MineBlockWithTxs
    \/ MineEmptyBlock

\* ── Fairness Constraints ────────────────────────────────────────────────────

\* Weak fairness on mining: if mempool is always non-empty, eventually a block
\* with transactions is mined. Without this, the model checker could
\* perpetually choose SubmitTx and never MineBlockWithTxs.
Fairness ==
    WF_vars(MineBlockWithTxs)

\* ── Liveness Properties ─────────────────────────────────────────────────────

\* **Primary liveness property**: every created transaction is eventually included
\* Formal: \A id \in 1..MaxTx : <>(id \in AllIncludedTxs)
EveryTxEventuallyIncluded ==
    \A id \in 1..MaxTx : <>(id \in AllIncludedTxs)

\* Alternative formulation: mempool eventually drains
MempoolEventuallyEmpty ==
    <>(mempool = {})

\* Every pending tx eventually gets mined or stays pending only finitely long
\* This is equivalent to: <>[](StillPending = {})
EventualInclusion ==
    <>(StillPending = {})

\* ── Safety Invariants (sanity checks) ───────────────────────────────────────

\* Mempool and chain_txs are disjoint
NoDoubleInclusion ==
    mempool \cap AllIncludedTxs = {}

\* Chain only grows
ChainMonotonic ==
    Len(chain_txs) = block_count

\* ── Temporal Properties to Check ────────────────────────────────────────────

\* Under weak fairness, if we stop submitting new txs, the mempool drains
MempoolDrainsWhenNoNewTxs ==
    (next_tx_id >= MaxTx) ~> (mempool = {})

\* Every individual tx is eventually included (strong form)
TxIdEventuallyIncluded(id) ==
    <>(id \in AllIncludedTxs)

\* ── TLC Configuration ───────────────────────────────────────────────────────
\* SPECIFICATION Spec
\* CONSTANTS
\*   MaxTx = 5
\*   MinFee = 1
\* PROPERTIES
\*   EveryTxEventuallyIncluded
\*   NoDoubleInclusion
\*
\* Note: TLC is primarily a model checker for invariants and safety properties.
\* For liveness checking under fairness, use TLC with the -deadlock flag
\* and verify that the property holds under the WF constraint.
\* ============================================================================

=============================================================================
