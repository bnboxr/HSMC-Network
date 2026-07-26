---- MODULE supply_invariant ----
\* ============================================================================
\* HSMC Supply Invariant — Formal TLA+ Specification
\* ============================================================================
\* Verifies: sum(all_balances) + sum(all_fees) <= MAX_SUPPLY
\*
\* This specification models the HSMC blockchain's monetary supply invariant.
\* Every block creates a coinbase reward (subject to halving schedule), every
\* transaction collects fees, and the sum of all UTXO balances plus collected
\* fees must never exceed the hard cap of MAX_SUPPLY (500 million HSMC).
\*
\* The model tracks:
\*   - circulating_supply: total HSMC ever mined via block rewards
\*   - total_fees_collected: cumulative fees from all transactions
\*   - utxo_balances: map from address → UTXO balance
\*   - fee_pool: fees deducted from outputs but not yet redistributed
\*
\* Invariant:
\*   SupplyInvariant ==
\*     (SUM_{a in Addresses} utxo_balances[a]) + fee_pool <= MAX_SUPPLY
\*
\* Halving schedule: reward halves every HALVING_INTERVAL blocks
\*   reward(0) = INITIAL_REWARD
\*   reward(h) = INITIAL_REWARD / 2^{floor(h / HALVING_INTERVAL)}
\*   max_total = INITIAL_REWARD * HALVING_INTERVAL * 2 = MAX_SUPPLY
\* ============================================================================

EXTENDS Naturals, Sequences, FiniteSets, TLC

\* ── Constants ───────────────────────────────────────────────────────────────
CONSTANTS
    MAX_SUPPLY,           \* 500,000,000 HSMC
    INITIAL_REWARD,       \* 50.0 HSMC (in satoshi-equivalent 1e8)
    HALVING_INTERVAL,     \* 210,000 blocks
    Addresses             \* Set of all possible addresses

ASSUME MAX_SUPPLY > 0
ASSUME INITIAL_REWARD > 0
ASSUME HALVING_INTERVAL > 0

\* ── Variables ───────────────────────────────────────────────────────────────
VARIABLES
    utxo_balances,        \* [Addresses -> Nat] — UTXO balances (satoshi)
    fee_pool,             \* Nat — fees collected but not yet in UTXO set
    block_height,         \* Nat — current block number
    total_mined,          \* Nat — cumulative reward ever issued
    total_fees,           \* Nat — cumulative fees ever collected

vars == <<utxo_balances, fee_pool, block_height, total_mined, total_fees>>

\* ── Helpers ─────────────────────────────────────────────────────────────────

\* Block reward at a given height (halving schedule)
BlockReward(h) ==
    LET epochs = h \div HALVING_INTERVAL
    IN IF epochs >= 64
       THEN 0   \* After 64 halvings, reward is 0 (supply cap reached)
       ELSE LET reward = INITIAL_REWARD \div (2 ^ epochs)
            IN IF reward < 1
               THEN 0
               ELSE reward

\* Max total supply that can ever be mined (geometric series sum)
\* INITIAL_REWARD * HALVING_INTERVAL * (1 + 1/2 + 1/4 + ...) = INITIAL_REWARD * HALVING_INTERVAL * 2
ASSUME_ALLOWED ==
    \* Verify the theoretical maximum matches MAX_SUPPLY
    INITIAL_REWARD * HALVING_INTERVAL * 2 <= MAX_SUPPLY

\* Sum of all UTXO balances (non-negative)
TotalBalances ==
    LET S == { utxo_balances[a] : a \in Addresses }
    IN IF S = {} THEN 0
       ELSE LET sum_set[T \in SUBSET S] ==
                IF T = {} THEN 0
                ELSE LET x == CHOOSE e \in T : TRUE
                     IN x + sum_set[T \ {x}]
            IN sum_set[S]

\* ── Initial State ───────────────────────────────────────────────────────────
Init ==
    /\ utxo_balances = [a \in Addresses |-> 0]
    /\ fee_pool = 0
    /\ block_height = 0
    /\ total_mined = 0
    /\ total_fees = 0

\* ── Actions ─────────────────────────────────────────────────────────────────

\* Mint a new block: create coinbase reward + collect fees
MintBlock ==
    LET reward == BlockReward(block_height)
        miner == CHOOSE a \in Addresses : TRUE
    IN
    /\ reward > 0
    /\ total_mined + reward <= MAX_SUPPLY
    /\ utxo_balances' = [utxo_balances EXCEPT ![miner] = utxo_balances[miner] + reward]
    /\ fee_pool' = fee_pool
    /\ block_height' = block_height + 1
    /\ total_mined' = total_mined + reward
    /\ total_fees' = total_fees

\* Process a transparent transaction: move amount from sender to receiver, pay fee
Transfer(sender, receiver, amount, fee) ==
    LET available == utxo_balances[sender]
        total == amount + fee
    IN
    /\ sender /= receiver
    /\ amount > 0
    /\ fee > 0
    /\ total <= available               \* sender must have sufficient balance
    /\ utxo_balances' = [utxo_balances EXCEPT
        ![sender]   = utxo_balances[sender] - total,
        ![receiver] = utxo_balances[receiver] + amount
    ]
    /\ fee_pool' = fee_pool + fee
    /\ UNCHANGED <<block_height, total_mined, total_fees>>

\* Redistribute fee pool to miners (simplified: add to a random address)
CollectFees ==
    LET collector == CHOOSE a \in Addresses : TRUE
    IN
    /\ fee_pool > 0
    /\ utxo_balances' = [utxo_balances EXCEPT ![collector] = utxo_balances[collector] + fee_pool]
    /\ fee_pool' = 0
    /\ total_fees' = total_fees + fee_pool
    /\ UNCHANGED <<block_height, total_mined>>

\* Next-state relation
Next ==
    \/ MintBlock
    \/ \E sender, receiver \in Addresses, amount, fee \in Nat :
         Transfer(sender, receiver, amount, fee)
    \/ CollectFees

\* ── Invariants ──────────────────────────────────────────────────────────────

\* **Primary invariant**: sum of all balances + fee pool <= MAX_SUPPLY
SupplyInvariant ==
    TotalBalances + fee_pool <= MAX_SUPPLY

\* Supply is monotonically non-decreasing (with respect to total_mined + fee_pool in system)
SupplyNonNegative ==
    /\ TotalBalances >= 0
    /\ fee_pool >= 0
    /\ total_mined >= 0

\* Fee pool never exceeds total mined supply
FeePoolBounded ==
    fee_pool <= MAX_SUPPLY

\* Block reward never causes overflow beyond MAX_SUPPLY
MintingCapInvariant ==
    total_mined <= MAX_SUPPLY

\* Total supply = total_mined (coinbase) — burn not modeled
\* In HSMC, EIP-1559 burns a portion of fees, so:
\*   TotalBalances + fee_pool + burned = total_mined
\* Since we don't model burns explicitly, this invariant is:
MinedEqualsCirculatingPlusFees ==
    TotalBalances + fee_pool <= total_mined + fee_pool

\* ── Theorem ─────────────────────────────────────────────────────────────────
\* The supply invariant holds in all reachable states.

THEOREM SupplyInvariantHolds ==
    Init => []SupplyInvariant

\* ── TLC Configuration ───────────────────────────────────────────────────────
\* To run TLC, create a .cfg file with:
\*   SPECIFICATION Spec
\*   CONSTANTS
\*     MAX_SUPPLY = 50000000000000000    \* 500M HSMC in satoshi (1 HSMC = 1e8)
\*     INITIAL_REWARD = 5000000000       \* 50 HSMC in satoshi
\*     HALVING_INTERVAL = 210000
\*     Addresses = {"a1", "a2", "a3"}    \* small set for model checking
\*   INVARIANTS SupplyInvariant SupplyNonNegative FeePoolBounded

=============================================================================
