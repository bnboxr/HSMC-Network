// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * wHSMC — Wrapped HSMC (BEP-20 / ERC-20)
 * ----------------------------------------------------------------------
 * Mintable / burnable representation of native HSMC on EVM chains
 * (BSC, Ethereum, Polygon). Mint is restricted to the BridgeMinter
 * multisig contract — never an EOA. Burn unlocks HSMC on the HSMC
 * mainnet via the bridge relayer.
 *
 * Audited surface:
 *   - OpenZeppelin ERC20 + ERC20Permit (EIP-2612) + AccessControl
 *   - Pausable for emergency stops (multisig-controlled)
 *   - 8 decimals to match HSMC native unit (1 HSMC = 1e8 satoshi-equivalent)
 *
 * Deploy order:
 *   1. Deploy Gnosis Safe (3-of-5 multisig)
 *   2. Deploy WHSMC with admin = Safe
 *   3. Deploy BridgeMinter with token = WHSMC, admin = Safe
 *   4. WHSMC.grantRole(MINTER_ROLE, BridgeMinter address)
 *   5. WHSMC.grantRole(PAUSER_ROLE, Safe address)
 *   6. Renounce DEFAULT_ADMIN_ROLE from deployer EOA
 */

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @custom:formal
/// ──── WHSMC Formal Verification Invariants ────────────────────────
///
/// ### INVARIANT 1: Total Supply Cap (verified by bridgeMint)
///   totalSupply() <= MAX_SUPPLY
///
///   Proof sketch:
///   - At deployment: totalSupply() = 0 <= MAX_SUPPLY (trivially true)
///   - The ONLY mint function is bridgeMint(), guarded by require(totalSupply() + amount <= MAX_SUPPLY)
///   - _mint() in OZ ERC20 updates totalSupply += amount atomically
///   - No other function increases totalSupply (burn only decreases)
///   - Therefore: totalSupply() <= MAX_SUPPLY for all reachable states
///
/// ### INVARIANT 2: Non-negative Balances
///   ∀ addr: balanceOf(addr) >= 0
///
///   Proof: OZ ERC20 _update enforces this; no underflow possible in Solidity ^0.8.x
///
/// ### INVARIANT 3: Sum of Balances = Total Supply
///   Σ balanceOf(a) for all a = totalSupply()
///
///   Proof: OZ ERC20 invariant; every _mint adds to both a balance and totalSupply;
///   every _burn subtracts from both
///
/// ### INVARIANT 4: MINTER_ROLE is sole minter
///   Only MINTER_ROLE can call bridgeMint() (enforced by onlyRole modifier)
///   bridgeMint is the ONLY mint entry point (no public mint, no fallback)
///
/// ### INVARIANT 5: Pausable consistency
///   When paused: all _update reverts (whenNotPaused on _update)
///   bridgeMint reverts (whenNotPaused)
///   bridgeBurn reverts (whenNotPaused)
///   Only PAUSER_ROLE can toggle (pause/unpause protected by role)
///
/// ### INVARIANT 6: MAX_SUPPLY representation
///   MAX_SUPPLY = 500_000_000 * 10^8 = 5e16 (fits in uint256: ~1.16e77)
///   No overflow risk in require check: totalSupply() <= MAX_SUPPLY and
///   amount <= MAX_SUPPLY, so totalSupply() + amount <= 2 * MAX_SUPPLY << 2^256
/// ────────────────────────────────────────────────────────────────

contract WHSMC is ERC20, ERC20Permit, ERC20Burnable, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Total HSMC supply hard-cap (500,000,000 HSMC = 500M)
    /// @custom:invariant totalSupply() <= MAX_SUPPLY
    uint256 public constant MAX_SUPPLY = 500_000_000 * 10 ** 8;

    event BridgeMint(address indexed to, uint256 amount, bytes32 indexed hsmcTxHash);
    event BridgeBurn(address indexed from, uint256 amount, string hsmcDestination);

    constructor(address admin)
        ERC20("Wrapped HSMC", "wHSMC")
        ERC20Permit("Wrapped HSMC")
    {
        require(admin != address(0), "admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    /// @notice Mint wHSMC after a verified HSMC mainnet lock event.
    /// @dev Only callable by BridgeMinter (multisig-attested).
    /// @custom:invariant totalSupply() <= MAX_SUPPLY after execution
    /// @custom:requires to != address(0)
    /// @custom:requires totalSupply() + amount <= MAX_SUPPLY
    /// @custom:ensures totalSupply() == old(totalSupply()) + amount
    /// @custom:ensures balanceOf(to) == old(balanceOf(to)) + amount
    function bridgeMint(address to, uint256 amount, bytes32 hsmcTxHash)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        require(to != address(0), "to=0");
        require(totalSupply() + amount <= MAX_SUPPLY, "exceeds cap");
        _mint(to, amount);
        emit BridgeMint(to, amount, hsmcTxHash);
    }

    /// @notice Burn wHSMC to release native HSMC on mainnet.
    /// @param hsmcDestination HSMC mainnet address (string form, 0x… 40 hex)
    function bridgeBurn(uint256 amount, string calldata hsmcDestination)
        external
        whenNotPaused
    {
        require(bytes(hsmcDestination).length == 42, "invalid hsmc addr");
        _burn(msg.sender, amount);
        emit BridgeBurn(msg.sender, amount, hsmcDestination);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function _update(address from, address to, uint256 value)
        internal
        override
        whenNotPaused
    {
        super._update(from, to, value);
    }
}
