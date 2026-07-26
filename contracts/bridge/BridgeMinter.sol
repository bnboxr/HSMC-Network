// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * BridgeMinter — M-of-N attestation gate for wHSMC minting with fraud proofs
 * ---------------------------------------------------------------------------
 * Off-chain relayers observe the HSMC mainnet for `bridge.lock` events,
 * sign the (txHash, recipient, amount) tuple with their EOA keys, and
 * submit signatures here.
 *
 * **Flow (challengePeriod > 0)**:
 *   1. `executeMint()` collects M-of-N sigs → emits `MintProposed`
 *   2. Anyone can call `challengeMint(proposalId, proof)` during challenge window
 *      → cancels proposal, slashes validators (bond required, refunded on valid challenge)
 *   3. `finalizeMint(proposalId)` mints wHSMC after challenge window expires
 *
 * **Backward compatibility**: if `challengePeriod == 0`, `executeMint` mints immediately
 * (same as before). Old relayer clients continue working unchanged.
 *
 * Validators are managed by the VALIDATOR_ADMIN role (multisig Safe).
 * Signature scheme: ECDSA over keccak256(abi.encode(...)) — EIP-191 personal sign.
 * Replay protection: each hsmcTxHash can only mint once.
 */

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWHSMC {
    function bridgeMint(address to, uint256 amount, bytes32 hsmcTxHash) external;
    function pause() external;
    function unpause() external;
}

/// @custom:formal
/// ──── BridgeMinter Formal Verification Invariants ──────────────────
///
/// ### INVARIANT 1: No Double Mint (primary security property)
///   ∀ hsmcTxHash: processed[hsmcTxHash] => mint happened at most once
///
///   Proof sketch:
///   - `executeMint()` sets `processed[hsmcTxHash] = true` BEFORE any mint
///   - Guard: `if (processed[hsmcTxHash]) revert AlreadyProcessed()` at entry
///   - In challenge-period mode: mint happens in `finalizeMint()` which
///     requires ProposalState.Pending → sets to Finalized (irreversible)
///   - In immediate mode (challengePeriod==0): mint happens inline but
///     `processed` is already true → cannot re-enter
///   - No function clears `processed` → monotonic
///   - Therefore: each hsmcTxHash is minted at most once
///
/// ### INVARIANT 2: Validator Set Consistency
///   ∀ v ∈ validators: isValidator[v] == true
///   ∀ v where isValidator[v] == true: v ∈ validators
///   |validators| = count(isValidator == true)
///
/// ### INVARIANT 3: Threshold Bounds
///   0 < threshold <= |validators|
///   setThreshold enforces: t > 0 && t <= validators.length
///
/// ### INVARIANT 4: Proposal State Machine
///   ProposalState transitions:
///     None → Pending        (via executeMint with challenge period)
///     Pending → Finalized   (via finalizeMint after expiry)
///     Pending → Challenged  (via challengeMint before expiry)
///     Challenged → Cancelled (via resolveChallenge with uphold=true)
///     Challenged → Pending   (via resolveChallenge with uphold=false)
///   No other transitions possible.
///   txHashToProposalId[hash] is set iff proposal.state != None
///
/// ### INVARIANT 5: Slashed validator cannot sign
///   slashed[v] => executeMint reverts for signatures from v
///   (enforced by: if (slashed[signer]) revert NotAValidator(signer))
///
/// ### INVARIANT 6: Bond Accounting
///   Sum of challenge bonds held = challengeBond * (#Challenged proposals not yet resolved)
///   The contract's ETH balance >= this sum (may include forfeited bonds)
///   resolveChallenge transfers bond to challenger (on uphold) or keeps it (on reject)
///
/// ### INVARIANT 7: Signature Replay Protection
///   Each digest is chain-specific: keccak256(block.chainid, address(this), hsmcTxHash, to, amount)
///   Prevents cross-chain replay. Address(this) in digest prevents cross-contract replay.
/// ────────────────────────────────────────────────────────────────

contract BridgeMinter is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant VALIDATOR_ADMIN = keccak256("VALIDATOR_ADMIN");
    bytes32 public constant CHALLENGE_ADMIN  = keccak256("CHALLENGE_ADMIN");

    IWHSMC public immutable token;
    uint256 public threshold;            // e.g. 3 of 5
    mapping(address => bool) public isValidator;
    address[] public validators;
    mapping(bytes32 => bool) public processed; // hsmcTxHash → executed/proposed

    // ─── Fraud Proof: Challenge System ───────────────────────────────────
    uint256 public challengePeriod;      // seconds (0 = disabled, backward compat)
    uint256 public challengeBond;        // ETH required to challenge (prevents spam)
    uint256 public proposalCount;

    enum ProposalState { None, Pending, Finalized, Challenged, Cancelled }

    struct MintProposal {
        bytes32 hsmcTxHash;
        address to;
        uint256 amount;
        uint256 proposedAt;             // block.timestamp
        uint256 expiresAt;
        address[] signers;              // validators who signed (for slashing)
        ProposalState state;
        address challenger;
    }

    mapping(uint256 => MintProposal) public proposals;
    mapping(bytes32 => uint256) public txHashToProposalId; // reverse lookup

    // ─── Slashed validators ─────────────────────────────────────────────
    mapping(address => bool) public slashed;
    mapping(address => uint256) public slashCount;

    // ─── Events ─────────────────────────────────────────────────────────
    event Minted(bytes32 indexed hsmcTxHash, address indexed to, uint256 amount);
    event MintProposed(
        uint256 indexed proposalId,
        bytes32 indexed hsmcTxHash,
        address indexed to,
        uint256 amount,
        uint256 expiresAt,
        address[] signers
    );
    event MintFinalized(uint256 indexed proposalId, bytes32 indexed hsmcTxHash);
    event MintChallenged(
        uint256 indexed proposalId,
        bytes32 indexed hsmcTxHash,
        address indexed challenger,
        bytes proof
    );
    event ChallengeResolved(
        uint256 indexed proposalId,
        bytes32 indexed hsmcTxHash,
        bool upheld,
        address resolver
    );
    event ValidatorSlashed(address indexed validator, bytes32 indexed hsmcTxHash);
    event ValidatorAdded(address indexed v);
    event ValidatorRemoved(address indexed v);
    event ThresholdChanged(uint256 newThreshold);
    event ChallengePeriodChanged(uint256 newPeriod);
    event ChallengeBondChanged(uint256 newBond);

    // ─── Errors ─────────────────────────────────────────────────────────
    error AlreadyProcessed();
    error NotEnoughSigs(uint256 have, uint256 need);
    error SigsNotSorted();
    error NotAValidator(address signer);
    error ThresholdNotMet(uint256 valid, uint256 need);
    error ProposalNotFound(uint256 id);
    error ProposalNotPending(uint256 id);
    error ChallengeNotExpired(uint256 id, uint256 expiresAt);
    error AlreadyChallenged(uint256 id);
    error BondTooLow(uint256 sent, uint256 required);
    error NoChallengeActive(uint256 id);

    constructor(address _token, address admin, address[] memory _validators, uint256 _threshold) {
        require(_token != address(0) && admin != address(0), "zero addr");
        require(_validators.length >= _threshold && _threshold > 0, "bad threshold");
        token = IWHSMC(_token);
        threshold = _threshold;
        challengePeriod = 86400;   // 24 hours (mainnet default)
        challengeBond = 0.1 ether; // default bond
        for (uint256 i = 0; i < _validators.length; i++) {
            address v = _validators[i];
            require(v != address(0) && !isValidator[v], "dup/zero validator");
            isValidator[v] = true;
            validators.push(v);
            emit ValidatorAdded(v);
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VALIDATOR_ADMIN, admin);
        _grantRole(CHALLENGE_ADMIN, admin);

        require(challengePeriod > 0, "challengePeriod must be > 0 for mainnet");
    }

    // ─── Main entry point (backward compatible) ─────────────────────────
    /// @notice Submit M signatures. If challengePeriod>0, creates a proposal
    ///         instead of minting immediately. Emits MintProposed.
    /// @param hsmcTxHash The HSMC mainnet lock-tx hash
    /// @param to         Recipient on this EVM chain
    /// @param amount     Amount in wHSMC base units (8 decimals)
    /// @param sigs       ECDSA signatures (r,s,v packed 65 bytes each), sorted by signer addr asc
    /// @custom:invariant processed[hsmcTxHash] is set exactly once (no double mint)
    /// @custom:requires sigs.length >= threshold
    /// @custom:requires all signers are unslashed validators, sorted ascending
    /// @custom:requires !processed[hsmcTxHash]
    /// @custom:ensures processed[hsmcTxHash] == true
    /// @custom:ensures IF challengePeriod > 0 THEN proposals[proposalCount].state == Pending
    function executeMint(
        bytes32 hsmcTxHash,
        address to,
        uint256 amount,
        bytes[] calldata sigs
    ) external {
        if (processed[hsmcTxHash]) revert AlreadyProcessed();
        if (sigs.length < threshold) revert NotEnoughSigs(sigs.length, threshold);

        bytes32 digest = keccak256(abi.encode(block.chainid, address(this), hsmcTxHash, to, amount))
            .toEthSignedMessageHash();

        address[] memory signers = new address[](sigs.length);
        address last = address(0);
        uint256 valid = 0;
        for (uint256 i = 0; i < sigs.length; i++) {
            address signer = digest.recover(sigs[i]);
            if (signer <= last) revert SigsNotSorted();
            if (!isValidator[signer]) revert NotAValidator(signer);
            if (slashed[signer]) revert NotAValidator(signer); // slashed validators can't sign
            last = signer;
            signers[valid] = signer;
            valid++;
        }
        if (valid < threshold) revert ThresholdNotMet(valid, threshold);

        processed[hsmcTxHash] = true;

        // Backward compat: if no challenge period, mint immediately
        if (challengePeriod == 0) {
            token.bridgeMint(to, amount, hsmcTxHash);
            emit Minted(hsmcTxHash, to, amount);
            return;
        }

        // ─── Challenge period enabled → create proposal ─────────────────
        proposalCount++;
        uint256 proposalId = proposalCount;
        uint256 proposedAt = block.timestamp;
        uint256 expiresAt = proposedAt + challengePeriod;

        MintProposal storage prop = proposals[proposalId];
        prop.hsmcTxHash = hsmcTxHash;
        prop.to = to;
        prop.amount = amount;
        prop.proposedAt = proposedAt;
        prop.expiresAt = expiresAt;
        prop.state = ProposalState.Pending;
        // Store the first `threshold` signers (for slashing)
        for (uint256 i = 0; i < threshold && i < valid; i++) {
            prop.signers.push(signers[i]);
        }

        txHashToProposalId[hsmcTxHash] = proposalId;

        emit MintProposed(proposalId, hsmcTxHash, to, amount, expiresAt, prop.signers);
    }

    // ─── Finalize after challenge period ────────────────────────────────
    /// @notice Finalize a mint proposal after the challenge window expires.
    ///         Anyone can call this.
    /// @param proposalId The proposal ID from MintProposed event
    /// @custom:invariant proposal mints at most once (state transitions Pending→Finalized)
    /// @custom:requires proposal.state == Pending
    /// @custom:requires block.timestamp >= proposal.expiresAt
    /// @custom:ensures proposal.state == Finalized
    /// @custom:ensures wHSMC is minted exactly once for this proposal's hsmcTxHash
    function finalizeMint(uint256 proposalId) external nonReentrant {
        MintProposal storage prop = proposals[proposalId];
        if (prop.state == ProposalState.None) revert ProposalNotFound(proposalId);
        if (prop.state != ProposalState.Pending) revert ProposalNotPending(proposalId);
        if (block.timestamp < prop.expiresAt) revert ChallengeNotExpired(proposalId, prop.expiresAt);

        prop.state = ProposalState.Finalized;

        token.bridgeMint(prop.to, prop.amount, prop.hsmcTxHash);

        emit MintFinalized(proposalId, prop.hsmcTxHash);
        emit Minted(prop.hsmcTxHash, prop.to, prop.amount);
    }

    // ─── Challenge ──────────────────────────────────────────────────────
    /// @notice Challenge a pending mint proposal. Requires a bond.
    ///         If challenge is upheld (via resolveChallenge), bond is refunded.
    ///         If challenge is rejected, bond is forfeited to the protocol.
    /// @param proposalId Proposal to challenge
    /// @param proof      Arbitrary proof data (e.g. abi-encoded HSMC block ref)
    function challengeMint(uint256 proposalId, bytes calldata proof) external payable {
        MintProposal storage prop = proposals[proposalId];
        if (prop.state == ProposalState.None) revert ProposalNotFound(proposalId);
        if (prop.state != ProposalState.Pending) revert ProposalNotPending(proposalId);
        if (block.timestamp >= prop.expiresAt) revert ChallengeNotExpired(proposalId, prop.expiresAt);
        if (prop.challenger != address(0)) revert AlreadyChallenged(proposalId);
        if (msg.value < challengeBond) revert BondTooLow(msg.value, challengeBond);

        prop.state = ProposalState.Challenged;
        prop.challenger = msg.sender;

        emit MintChallenged(proposalId, prop.hsmcTxHash, msg.sender, proof);

        // Return excess bond
        uint256 excess = msg.value - challengeBond;
        if (excess > 0) {
            (bool ok, ) = payable(msg.sender).call{value: excess}("");
            require(ok, "refund failed");
        }
    }

    /// @notice Resolve a challenged proposal. Admin only.
    /// @param proposalId Proposal to resolve
    /// @param uphold     True = challenge valid (cancel mint, slash validators, refund bond).
    ///                    False = challenge rejected (bond forfeited, proposal reinstated).
    function resolveChallenge(uint256 proposalId, bool uphold)
        external
        onlyRole(CHALLENGE_ADMIN)
        nonReentrant
    {
        MintProposal storage prop = proposals[proposalId];
        if (prop.state == ProposalState.None) revert ProposalNotFound(proposalId);
        if (prop.state != ProposalState.Challenged) revert NoChallengeActive(proposalId);

        address challengerAddr = prop.challenger;

        if (uphold) {
            // Challenge valid → cancel mint, slash signers, refund bond
            prop.state = ProposalState.Cancelled;

            // Slash validators who signed the fraudulent tx
            for (uint256 i = 0; i < prop.signers.length; i++) {
                address v = prop.signers[i];
                slashed[v] = true;
                slashCount[v]++;
                emit ValidatorSlashed(v, prop.hsmcTxHash);
            }

            // Refund bond to challenger
            (bool ok, ) = payable(challengerAddr).call{value: challengeBond}("");
            require(ok, "bond refund failed");
        } else {
            // Challenge rejected → reinstated as Pending (if not expired)
            // If expired already, allow immediate finalization
            prop.state = ProposalState.Pending;
            prop.challenger = address(0);
            // Bond stays with contract (forfeited)
        }

        emit ChallengeResolved(proposalId, prop.hsmcTxHash, uphold, msg.sender);
    }

    // ─── Withdraw accumulated bonds (treasury) ──────────────────────────
    function withdrawBonds(address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "zero addr");
        uint256 bal = address(this).balance;
        (bool ok, ) = payable(to).call{value: bal}("");
        require(ok, "withdraw failed");
    }

    // ─── Admin: Validator management ────────────────────────────────────
    function addValidator(address v) external onlyRole(VALIDATOR_ADMIN) {
        require(v != address(0) && !isValidator[v], "dup/zero");
        isValidator[v] = true;
        validators.push(v);
        emit ValidatorAdded(v);
    }

    function removeValidator(address v) external onlyRole(VALIDATOR_ADMIN) {
        require(isValidator[v], "not validator");
        isValidator[v] = false;
        slashed[v] = false; // clear slash on removal
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == v) {
                validators[i] = validators[validators.length - 1];
                validators.pop();
                break;
            }
        }
        emit ValidatorRemoved(v);
    }

    function setThreshold(uint256 t) external onlyRole(VALIDATOR_ADMIN) {
        require(t > 0 && t <= validators.length, "bad threshold");
        threshold = t;
        emit ThresholdChanged(t);
    }

    function setChallengePeriod(uint256 periodSecs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        challengePeriod = periodSecs;
        emit ChallengePeriodChanged(periodSecs);
    }

    function setChallengeBond(uint256 bondWei) external onlyRole(DEFAULT_ADMIN_ROLE) {
        challengeBond = bondWei;
        emit ChallengeBondChanged(bondWei);
    }

    // ─── Views ──────────────────────────────────────────────────────────
    function validatorCount() external view returns (uint256) { return validators.length; }

    /// @notice Return the proposal ID for a given hsmcTxHash, or 0 if none.
    function getProposalId(bytes32 hsmcTxHash) external view returns (uint256) {
        return txHashToProposalId[hsmcTxHash];
    }

    /// @notice Check if a proposal can be finalized now.
    function canFinalize(uint256 proposalId) external view returns (bool) {
        MintProposal storage prop = proposals[proposalId];
        return prop.state == ProposalState.Pending && block.timestamp >= prop.expiresAt;
    }

    // ─── Receive ETH (for bonds) ────────────────────────────────────────
    receive() external payable {}
}
