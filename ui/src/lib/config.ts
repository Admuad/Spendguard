import { createPublicClient, defineChain, http, parseAbi } from "viem";

/**
 * Single config file for all public SpendGuard UI settings.
 * No private keys, no secrets, no env vars: the app builds and runs with
 * zero environment configuration.
 */

// ---------------------------------------------------------------------------
// Chain: QDay Aevum testnet (chain 44005). Values corroborated by the
// starter guide, the QDay wiki, and live on-chain reads (18 Nov 2026).
// ---------------------------------------------------------------------------
export const aevumTestnet = defineChain({
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-test.qday.info"] },
  },
  blockExplorers: {
    default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const RPC_URL = "https://rpc-test.qday.info";
export const EXPLORER_URL = "https://explorer-test.qday.info";
export const FAUCET_URL = "https://faucet.qday.info/en";
export const REPO_URL = "https://github.com/Admuad/Spendguard";
export const DORAHACKS_URL = "https://dorahacks.io/hackathon/qday/detail";

// Deployed SpendGuard vault (18 Nov 2026). Deploy tx:
// 0xbe573e67a296cab6bacb5cfb1cfe91bef681171037db06e4383d7caa666536d3
export const VAULT_ADDRESS =
  "0x9a113999851e446a7ab516472e2dae743fc2a0ca" as const;
export const TUSD8_ADDRESS =
  "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
export const TUSD8_DECIMALS = 6;

/** Block the vault was deployed in — the event scan starts here. Verified from the deploy receipt (tx 0xbe573e67…). */
export const DEPLOY_BLOCK = 3461010n;
/** Aevum's eth_getLogs accepts at most 1,000 blocks per call (kit gotcha). */
export const MAX_LOG_RANGE = 1000n;

/**
 * Demo video URL. Leave empty until the video exists: the Watch Demo modal
 * then shows an honest "coming soon" placeholder instead of a dead link.
 * Set to the final hosted video URL (login-free link) when it is published.
 */
export const DEMO_VIDEO_URL = "";

/** Read-only client over the public RPC. No wallet needed for reads. */
export const readClient = createPublicClient({
  chain: aevumTestnet,
  transport: http(RPC_URL),
});

// ---------------------------------------------------------------------------
// SpendGuard ABI — mirrors src/SpendGuard.sol exactly. Do not guess: any
// contract change must be reflected here.
// ---------------------------------------------------------------------------
export const spendGuardAbi = parseAbi([
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function deposit(uint256 amount)",
  "function grantSession(address sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint64 expiresAt)",
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
  "event SessionRevoked(address indexed sessionKey, uint256 spent, uint256 remainingCap)",
  "event PaymentExecuted(address indexed sessionKey, address indexed recipient, uint256 amount, uint256 newSpent, uint256 remainingCap)",
  "event OwnerWithdraw(address indexed owner, uint256 amount, uint256 newBalance)",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error ZeroSpendCap()",
  "error ZeroMaxPerTx()",
  "error MaxPerTxExceedsSpendCap()",
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

/** Minimal ERC-20 surface the UI needs (approve / allowance / balance). */
export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
