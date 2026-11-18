// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SpendGuard
/// @notice A scoped session-key vault for a single ERC-20 (tUSD8 on Aevum testnet).
/// @dev The owner deposits once, then grants session keys that may spend only to
/// allowlisted recipients, within a per-transaction cap and a cumulative spend
/// cap, before an expiry. Every bound is enforced on-chain; the owner can revoke
/// instantly and can always sweep the remaining balance, paused or not.
///
/// Security specification: THREAT-MODEL.md. Invariant numbers in comments below
/// (INV-1..INV-17) refer to that document.
///
/// Design notes pinned by the threat model:
/// - Expiry is a hard cutoff: a payment is valid only while
///   `block.timestamp < expiresAt`. A payment in the exact expiry second reverts.
/// - Pause freezes spending, never recovery: `ownerWithdraw` works while paused.
/// - There is no edit operation. To change a session, revoke it and grant a new
///   one; the new session starts with `spent == 0`.
/// - The vault never grants an ERC-20 approval to any address (INV-13).
/// - All token movement goes through SafeERC20 as defense-in-depth (A-1):
///   the deployed tUSD8 reverts on failure (fork-verified 18 Nov 2026), and
///   a silent `false` from any non-standard token would still revert the
///   vault operation and never corrupt accounting.
/// - Deposits are measured by balance delta, so accounting stays correct even if
///   the token ever takes a transfer fee (threat model V-1 fallback).
contract SpendGuard is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice The token this vault holds (tUSD8 on Aevum testnet).
    IERC20 public immutable token;

    /// @notice A single session grant. `recipients` is stored for enumeration
    /// (UI/audit); the allowlist check itself uses the O(1) mapping below.
    struct Session {
        uint256 maxPerTx;
        uint256 spendCap;
        uint256 spent;
        uint64 expiresAt;
        bool active;
        address[] recipients;
    }

    mapping(address => Session) private _sessions;
    mapping(address => mapping(address => bool)) private _isRecipientAllowed;

    event Deposit(address indexed depositor, uint256 amount, uint256 newBalance);
    event SessionGranted(
        address indexed sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint256 expiresAt
    );
    event SessionRevoked(address indexed sessionKey, uint256 spent, uint256 remainingCap);
    event PaymentExecuted(
        address indexed sessionKey, address indexed recipient, uint256 amount, uint256 newSpent, uint256 remainingCap
    );
    event OwnerWithdraw(address indexed owner, uint256 amount, uint256 newBalance);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroSpendCap();
    error ZeroMaxPerTx();
    error MaxPerTxExceedsSpendCap();
    error ExpiryInPast();
    error EmptyAllowlist();
    error SessionAlreadyActive();
    error SessionNotActive();
    error SessionExpired();
    error RecipientNotAllowed();
    error CapExceeded();
    error PerTxLimitExceeded();
    error CallerNotSessionKey();
    error InsufficientVaultBalance();

    /// @param token_ The ERC-20 this vault holds. Must not be the zero address.
    constructor(address token_) Ownable(msg.sender) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
    }

    /// @notice Deposit `amount` of the vault token. Anyone may deposit;
    /// depositing can only increase the vault balance, never decrease it.
    /// The caller must have approved the vault for at least `amount`.
    /// @dev Pulls exactly `amount` via transferFrom (INV-13) and credits the
    /// balance delta actually received, so a fee-on-transfer token cannot
    /// corrupt accounting (INV-5, INV-17).
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 balanceBefore = token.balanceOf(address(this));
        // SafeERC20: reverts if the token returns false instead of reverting.
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        emit Deposit(msg.sender, received, token.balanceOf(address(this)));
    }

    /// @notice Grant (or re-grant) a session key. Owner only.
    /// @dev Re-granting a revoked or expired key starts a FRESH session:
    /// the old allowlist is cleared and `spent` resets to 0 (INV-16).
    /// Granting to an already-active key reverts: revoke first (INV-11).
    /// Grants are allowed while paused; pause blocks payments, not admin.
    function grantSession(
        address sessionKey,
        address[] calldata recipients,
        uint256 maxPerTx,
        uint256 spendCap,
        uint64 expiresAt
    ) external onlyOwner {
        if (sessionKey == address(0)) revert ZeroAddress();
        if (spendCap == 0) revert ZeroSpendCap();
        if (maxPerTx == 0) revert ZeroMaxPerTx();
        if (maxPerTx > spendCap) revert MaxPerTxExceedsSpendCap();
        if (expiresAt <= block.timestamp) revert ExpiryInPast();
        if (recipients.length == 0) revert EmptyAllowlist();
        if (_sessions[sessionKey].active) revert SessionAlreadyActive();

        // Clear the previous session's allowlist entries, if any, so a
        // re-grant cannot inherit recipients from the old session.
        address[] storage oldRecipients = _sessions[sessionKey].recipients;
        for (uint256 i = 0; i < oldRecipients.length; i++) {
            _isRecipientAllowed[sessionKey][oldRecipients[i]] = false;
        }

        Session storage session = _sessions[sessionKey];
        session.maxPerTx = maxPerTx;
        session.spendCap = spendCap;
        session.spent = 0;
        session.expiresAt = expiresAt;
        session.active = true;
        session.recipients = recipients;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            _isRecipientAllowed[sessionKey][recipients[i]] = true;
        }

        emit SessionGranted(sessionKey, recipients, maxPerTx, spendCap, expiresAt);
    }

    /// @notice Revoke a session key immediately. Owner only. Once mined, the
    /// key can never spend again (INV-7). The key's `spent` is preserved for
    /// the audit trail; only a fresh grant resets it (INV-16).
    function revokeSession(address sessionKey) external onlyOwner {
        Session storage session = _sessions[sessionKey];
        if (!session.active) revert SessionNotActive();
        session.active = false;
        emit SessionRevoked(sessionKey, session.spent, session.spendCap - session.spent);
    }

    /// @notice Spend from the vault under a session key's bounds.
    /// @dev Caller MUST be the session-key address itself (INV-14).
    /// Checks-effects-interactions (INV-9) plus the reentrancy guard (INV-10):
    /// `spent` is updated before the external token transfer.
    function executePayment(address sessionKey, address recipient, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        if (msg.sender != sessionKey) revert CallerNotSessionKey();
        Session storage session = _sessions[sessionKey];
        if (!session.active) revert SessionNotActive();
        if (block.timestamp >= session.expiresAt) revert SessionExpired();
        if (amount == 0) revert ZeroAmount();
        if (amount > session.maxPerTx) revert PerTxLimitExceeded();
        if (session.spent + amount > session.spendCap) revert CapExceeded();
        if (!_isRecipientAllowed[sessionKey][recipient]) revert RecipientNotAllowed();
        if (token.balanceOf(address(this)) < amount) revert InsufficientVaultBalance();

        // Effects before interaction (INV-9).
        session.spent += amount;

        // SafeERC20: reverts if the token returns false instead of reverting.
        token.safeTransfer(recipient, amount);

        emit PaymentExecuted(sessionKey, recipient, amount, session.spent, session.spendCap - session.spent);
    }

    /// @notice Sweep the full remaining vault balance to the owner. Owner only.
    /// Works in every state, including while paused (INV-4, INV-6): pause
    /// freezes spending, never recovery. Has no dependency on session state.
    function ownerWithdraw() external nonReentrant onlyOwner {
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(owner(), amount);
        emit OwnerWithdraw(owner(), amount, token.balanceOf(address(this)));
    }

    /// @notice Freeze all payments. Owner only. Does not block `ownerWithdraw`.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume payments. Owner only.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Full session state for a key, including its recipient list.
    function getSession(address sessionKey) external view returns (Session memory) {
        return _sessions[sessionKey];
    }

    /// @notice Whether `recipient` is on `sessionKey`'s allowlist.
    function isRecipientAllowed(address sessionKey, address recipient) external view returns (bool) {
        return _isRecipientAllowed[sessionKey][recipient];
    }

    /// @notice Remaining spendable amount under a key's cumulative cap.
    function remainingCap(address sessionKey) external view returns (uint256) {
        Session storage session = _sessions[sessionKey];
        return session.spendCap - session.spent;
    }

    /// @notice The vault's token balance: the single source of truth for
    /// solvency (INV-17).
    function vaultBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
