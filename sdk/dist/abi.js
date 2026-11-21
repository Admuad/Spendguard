/**
 * ABIs for SpendGuard, SpendGuardFactory, and the minimal ERC-20 surface
 * the SDK needs. Written as human-readable signatures and parsed with
 * viem's parseAbi, so they mirror src/SpendGuard.sol and
 * src/SpendGuardFactory.sol exactly. No build step is needed to read them.
 */
import { parseAbi } from "viem";
/** SpendGuard vault. Mirrors src/SpendGuard.sol. */
export const spendGuardAbi = parseAbi([
    "function token() view returns (address)",
    "function owner() view returns (address)",
    "function paused() view returns (bool)",
    "function deposit(uint256 amount)",
    "function grantSession(address sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint64 expiresAt)",
    "function editSession(address sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint64 expiresAt)",
    "function revokeSession(address sessionKey)",
    "function executePayment(address sessionKey, address recipient, uint256 amount)",
    "function ownerWithdraw()",
    "function pause()",
    "function unpause()",
    "function getSession(address sessionKey) view returns ((uint256 maxPerTx, uint256 spendCap, uint256 spent, uint64 expiresAt, bool active, address[] recipients))",
    "function isRecipientAllowed(address sessionKey, address recipient) view returns (bool)",
    "function remainingCap(address sessionKey) view returns (uint256)",
    "function vaultBalance() view returns (uint256)",
    "event Deposit(address indexed depositor, uint256 amount, uint256 newBalance)",
    "event SessionGranted(address indexed sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint256 expiresAt)",
    "event SessionEdited(address indexed sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint256 expiresAt)",
    "event SessionRevoked(address indexed sessionKey, uint256 spent, uint256 remainingCap)",
    "event PaymentExecuted(address indexed sessionKey, address indexed recipient, uint256 amount, uint256 newSpent, uint256 remainingCap)",
    "event OwnerWithdraw(address indexed owner, uint256 amount, uint256 newBalance)",
    "error ZeroAddress()",
    "error ZeroAmount()",
    "error ZeroSpendCap()",
    "error ZeroMaxPerTx()",
    "error MaxPerTxExceedsSpendCap()",
    "error CapBelowSpent()",
    "error ExpiryInPast()",
    "error EmptyAllowlist()",
    "error SessionAlreadyActive()",
    "error SessionNotActive()",
    "error SessionExpired()",
    "error RecipientNotAllowed()",
    "error CapExceeded()",
    "error PerTxLimitExceeded()",
    "error CallerNotSessionKey()",
    "error InsufficientVaultBalance()",
]);
/** SpendGuardFactory. Mirrors src/SpendGuardFactory.sol. */
export const spendGuardFactoryAbi = parseAbi([
    "function token() view returns (address)",
    "function allVaults(uint256 index) view returns (address)",
    "function createVault() returns (address vault)",
    "function vaultsOf(address owner) view returns (address[])",
    "function vaultCount() view returns (uint256)",
    "event VaultCreated(address indexed owner, address indexed vault, uint256 index)",
    "error ZeroAddress()",
]);
/** Minimal ERC-20 surface: the approve + balance reads the SDK needs. */
export const erc20Abi = parseAbi([
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 amount)",
    "event Approval(address indexed owner, address indexed spender, uint256 amount)",
]);
//# sourceMappingURL=abi.js.map