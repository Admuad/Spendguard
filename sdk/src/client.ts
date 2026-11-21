/**
 * SpendGuard SDK client.
 *
 * Two roles, two clients. The OWNER client (a wallet that owns a vault)
 * creates vaults, deposits, grants and revokes session keys, pauses, and
 * sweeps. The SESSION-KEY client (a wallet holding only a session key)
 * can do exactly one thing: executePayment within its on-chain bounds.
 * The contract enforces those bounds; the pre-flight check in canSpend()
 * is a second layer, not the only layer.
 *
 * Reads work with a public client only. Writes need a wallet client.
 * Every write uses a legacy (type 0) transaction, which is what Aevum
 * expects, and waits for one confirmation before returning.
 */

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AEVUM_CHAIN_ID,
  AEVUM_LOG_CHUNK_BLOCKS,
  AEVUM_RPC_URL,
  AEVUM_TX_TYPE,
  SPENDGUARD_DEPLOY_BLOCK,
  SPENDGUARD_FACTORY_ADDRESS,
  TUSD8_ADDRESS,
  TUSD8_DECIMALS,
} from "./constants.js";
import { erc20Abi, spendGuardAbi, spendGuardFactoryAbi } from "./abi.js";

export const aevumTestnet: Chain = defineChain({
  id: AEVUM_CHAIN_ID,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [AEVUM_RPC_URL] } },
  blockExplorers: {
    default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" },
  },
});

/** A session grant, as the vault stores it. */
export interface Session {
  maxPerTx: bigint;
  spendCap: bigint;
  spent: bigint;
  expiresAt: bigint;
  active: boolean;
  recipients: Address[];
}

/** The bounds an owner sets when granting (or editing) a session. */
export interface SessionGrant {
  sessionKey: Address;
  recipients: Address[];
  /** Largest single payment, in base units (tUSD8 has 6 decimals). */
  maxPerTx: bigint;
  /** Largest total the key may ever spend, in base units. */
  spendCap: bigint;
  /** Unix seconds. A payment is valid only while now < expiresAt. */
  expiresAt: bigint;
}

/** One on-chain payment, decoded from a PaymentExecuted event. */
export interface Payment {
  sessionKey: Address;
  recipient: Address;
  amount: bigint;
  newSpent: bigint;
  remainingCap: bigint;
  transactionHash: Hash;
  blockNumber: bigint;
}

/** One session grant, decoded from a SessionGranted event. */
export interface SessionGrantedEvent {
  sessionKey: Address;
  recipients: Address[];
  maxPerTx: bigint;
  spendCap: bigint;
  expiresAt: bigint;
  transactionHash: Hash;
  blockNumber: bigint;
}

/** The result of a pre-flight spend check. */
export type SpendCheck =
  | { ok: true }
  | { ok: false; reason: string };

export interface SpendGuardClientOptions {
  /** Defaults to the Aevum testnet RPC. */
  rpcUrl?: string;
  /** Bring your own public client (for example a local fork). */
  publicClient?: PublicClient;
  /** Needed for writes. Omit for a read-only client. */
  walletClient?: WalletClient;
  /** Defaults to the deployed factory. */
  factoryAddress?: Address;
}

export interface SpendGuardClient {
  readonly factoryAddress: Address;
  readonly publicClient: PublicClient;
  readonly walletClient?: WalletClient;
  createVault(): Promise<{ vault: Address; transactionHash: Hash }>;
  vaultsOf(owner: Address): Promise<Address[]>;
  vaultCount(): Promise<bigint>;
  allVaults(index: bigint): Promise<Address>;
  deposit(vault: Address, amount: bigint): Promise<{ approveHash?: Hash; depositHash: Hash }>;
  grantSession(vault: Address, grant: SessionGrant): Promise<Hash>;
  editSession(vault: Address, grant: SessionGrant): Promise<Hash>;
  revokeSession(vault: Address, sessionKey: Address): Promise<Hash>;
  executePayment(vault: Address, sessionKey: Address, recipient: Address, amount: bigint): Promise<Hash>;
  pause(vault: Address): Promise<Hash>;
  unpause(vault: Address): Promise<Hash>;
  ownerWithdraw(vault: Address): Promise<Hash>;
  getSession(vault: Address, sessionKey: Address): Promise<Session>;
  remainingCap(vault: Address, sessionKey: Address): Promise<bigint>;
  vaultBalance(vault: Address): Promise<bigint>;
  isRecipientAllowed(vault: Address, sessionKey: Address, recipient: Address): Promise<boolean>;
  isPaused(vault: Address): Promise<boolean>;
  vaultOwner(vault: Address): Promise<Address>;
  vaultToken(vault: Address): Promise<Address>;
  canSpend(vault: Address, sessionKey: Address, recipient: Address, amount: bigint): Promise<SpendCheck>;
  getPayments(vault: Address, fromBlock?: bigint, toBlock?: bigint): Promise<Payment[]>;
  getSessionGrants(vault: Address, fromBlock?: bigint, toBlock?: bigint): Promise<SessionGrantedEvent[]>;
  tokenBalance(owner: Address): Promise<bigint>;
  tokenAllowance(owner: Address, spender: Address): Promise<bigint>;
}

function requireWallet(client: SpendGuardClient): WalletClient {
  if (!client.walletClient) {
    throw new Error(
      "This call writes to the chain and needs a wallet client. Pass walletClient to createSpendGuardClient, or use createSpendGuardWalletClient.",
    );
  }
  return client.walletClient;
}

function requireAccount(client: SpendGuardClient): Account {
  const account = requireWallet(client).account;
  if (!account) throw new Error("Wallet client has no account");
  return account;
}

function requireAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new Error(`${label} is not a valid address: ${value}`);
  return getAddress(value);
}

interface WriteParams {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account: Account;
}

async function writeAndWait(client: SpendGuardClient, params: WriteParams): Promise<Hash> {
  const wallet = requireWallet(client);
  const hash = await wallet.writeContract({
    ...params,
    chain: aevumTestnet,
    type: AEVUM_TX_TYPE,
  } as never);
  const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return hash;
}

/**
 * Create a client. Reads work out of the box; pass a walletClient to write.
 *
 * @example
 * ```ts
 * import { createSpendGuardClient } from "spendguard-sdk";
 *
 * const readOnly = createSpendGuardClient();
 * const balance = await readOnly.vaultBalance("0x048a...");
 * ```
 */
export function createSpendGuardClient(options: SpendGuardClientOptions = {}): SpendGuardClient {
  const rpcUrl = options.rpcUrl ?? AEVUM_RPC_URL;
  const publicClient =
    options.publicClient ??
    createPublicClient({ chain: aevumTestnet, transport: http(rpcUrl) });
  const factoryAddress = options.factoryAddress ?? SPENDGUARD_FACTORY_ADDRESS;

  const client: SpendGuardClient = {
    factoryAddress,
    publicClient,
    walletClient: options.walletClient,

    async createVault() {
      const hash = await writeAndWait(client, {
        address: factoryAddress,
        abi: spendGuardFactoryAbi,
        functionName: "createVault",
        account: requireAccount(client),
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: spendGuardFactoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "VaultCreated") {
            return { vault: decoded.args.vault as Address, transactionHash: hash };
          }
        } catch {
          // Not a VaultCreated log; keep scanning.
        }
      }
      throw new Error(`VaultCreated event not found in receipt ${hash}`);
    },

    async vaultsOf(owner) {
      const result = await publicClient.readContract({
        address: factoryAddress,
        abi: spendGuardFactoryAbi,
        functionName: "vaultsOf",
        args: [requireAddress(owner, "owner")],
      });
      return [...result];
    },

    async vaultCount() {
      return publicClient.readContract({
        address: factoryAddress,
        abi: spendGuardFactoryAbi,
        functionName: "vaultCount",
      });
    },

    async allVaults(index) {
      return publicClient.readContract({
        address: factoryAddress,
        abi: spendGuardFactoryAbi,
        functionName: "allVaults",
        args: [index],
      });
    },

    async deposit(vault, amount) {
      const vaultAddr = requireAddress(vault, "vault");
      if (amount <= 0n) throw new Error("Deposit amount must be greater than zero");
      const account = requireAccount(client);
      const allowance = await client.tokenAllowance(account.address, vaultAddr);
      let approveHash: Hash | undefined;
      if (allowance < amount) {
        approveHash = await writeAndWait(client, {
          address: TUSD8_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultAddr, amount],
          account,
        });
      }
      const depositHash = await writeAndWait(client, {
        address: vaultAddr,
        abi: spendGuardAbi,
        functionName: "deposit",
        args: [amount],
        account,
      });
      return { approveHash, depositHash };
    },

    async grantSession(vault, grant) {
      const wallet = requireWallet(client);
      return writeAndWait(client, {
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "grantSession",
        args: [
          requireAddress(grant.sessionKey, "sessionKey"),
          grant.recipients.map((r) => requireAddress(r, "recipient")),
          grant.maxPerTx,
          grant.spendCap,
          grant.expiresAt,
        ],
        account: requireAccount(client),
      });
    },

    async editSession(vault, grant) {
      const wallet = requireWallet(client);
      return writeAndWait(client, {
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "editSession",
        args: [
          requireAddress(grant.sessionKey, "sessionKey"),
          grant.recipients.map((r) => requireAddress(r, "recipient")),
          grant.maxPerTx,
          grant.spendCap,
          grant.expiresAt,
        ],
        account: requireAccount(client),
      });
    },

    async revokeSession(vault, sessionKey) {
      const wallet = requireWallet(client);
      return writeAndWait(client, {
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "revokeSession",
        args: [requireAddress(sessionKey, "sessionKey")],
        account: requireAccount(client),
      });
    },

    async executePayment(vault, sessionKey, recipient, amount) {
      const wallet = requireWallet(client);
      return writeAndWait(client, {
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "executePayment",
        args: [
          requireAddress(sessionKey, "sessionKey"),
          requireAddress(recipient, "recipient"),
          amount,
        ],
        account: requireAccount(client),
      });
    },

    async pause(vault) {
      const wallet = requireWallet(client);
      return writeAndWait(client, {
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "pause",
        account: requireAccount(client),
      });
    },

    async unpause(vault) {
      const wallet = requireWallet(client);
      return writeAndWait(client, {
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "unpause",
        account: requireAccount(client),
      });
    },

    async ownerWithdraw(vault) {
      const wallet = requireWallet(client);
      return writeAndWait(client, {
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "ownerWithdraw",
        account: requireAccount(client),
      });
    },

    async getSession(vault, sessionKey) {
      const raw = await publicClient.readContract({
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "getSession",
        args: [requireAddress(sessionKey, "sessionKey")],
      });
      return {
        maxPerTx: raw.maxPerTx,
        spendCap: raw.spendCap,
        spent: raw.spent,
        expiresAt: raw.expiresAt,
        active: raw.active,
        recipients: [...raw.recipients],
      };
    },

    async remainingCap(vault, sessionKey) {
      return publicClient.readContract({
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "remainingCap",
        args: [requireAddress(sessionKey, "sessionKey")],
      });
    },

    async vaultBalance(vault) {
      return publicClient.readContract({
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "vaultBalance",
      });
    },

    async isRecipientAllowed(vault, sessionKey, recipient) {
      return publicClient.readContract({
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "isRecipientAllowed",
        args: [requireAddress(sessionKey, "sessionKey"), requireAddress(recipient, "recipient")],
      });
    },

    async isPaused(vault) {
      return publicClient.readContract({
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "paused",
      });
    },

    async vaultOwner(vault) {
      return publicClient.readContract({
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "owner",
      });
    },

    async vaultToken(vault) {
      return publicClient.readContract({
        address: requireAddress(vault, "vault"),
        abi: spendGuardAbi,
        functionName: "token",
      });
    },

    async canSpend(vault, sessionKey, recipient, amount) {
      const vaultAddr = requireAddress(vault, "vault");
      const key = requireAddress(sessionKey, "sessionKey");
      const to = requireAddress(recipient, "recipient");
      if (amount <= 0n) return { ok: false, reason: "Amount must be greater than zero" };
      if (await client.isPaused(vaultAddr)) return { ok: false, reason: "Vault is paused" };
      const session = await client.getSession(vaultAddr, key);
      if (!session.active) return { ok: false, reason: "Session is not active (revoked or never granted)" };
      if (BigInt(Math.floor(Date.now() / 1000)) >= session.expiresAt) {
        return { ok: false, reason: "Session has expired" };
      }
      if (amount > session.maxPerTx) {
        return { ok: false, reason: `Amount exceeds the per-transaction limit of ${formatUnits(session.maxPerTx, TUSD8_DECIMALS)} tUSD8` };
      }
      if (session.spent + amount > session.spendCap) {
        return { ok: false, reason: `Amount exceeds the remaining cap of ${formatUnits(session.spendCap - session.spent, TUSD8_DECIMALS)} tUSD8` };
      }
      if (!(await client.isRecipientAllowed(vaultAddr, key, to))) {
        return { ok: false, reason: "Recipient is not on this session key's allowlist" };
      }
      const balance = await client.vaultBalance(vaultAddr);
      if (balance < amount) {
        return { ok: false, reason: `Vault holds only ${formatUnits(balance, TUSD8_DECIMALS)} tUSD8` };
      }
      return { ok: true };
    },

    async getPayments(vault, fromBlock = SPENDGUARD_DEPLOY_BLOCK, toBlock) {
      const vaultAddr = requireAddress(vault, "vault");
      const end = toBlock ?? (await publicClient.getBlockNumber());
      const out: Payment[] = [];
      for (let start = fromBlock; start <= end; start += AEVUM_LOG_CHUNK_BLOCKS + 1n) {
        const chunkEnd = start + AEVUM_LOG_CHUNK_BLOCKS > end ? end : start + AEVUM_LOG_CHUNK_BLOCKS;
        const logs = await publicClient.getLogs({
          address: vaultAddr,
          event: {
            type: "event",
            name: "PaymentExecuted",
            inputs: [
              { type: "address", name: "sessionKey", indexed: true },
              { type: "address", name: "recipient", indexed: true },
              { type: "uint256", name: "amount" },
              { type: "uint256", name: "newSpent" },
              { type: "uint256", name: "remainingCap" },
            ],
          },
          fromBlock: start,
          toBlock: chunkEnd,
        });
        for (const log of logs) {
          out.push({
            sessionKey: log.args.sessionKey as Address,
            recipient: log.args.recipient as Address,
            amount: log.args.amount as bigint,
            newSpent: log.args.newSpent as bigint,
            remainingCap: log.args.remainingCap as bigint,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
        }
      }
      return out;
    },

    async getSessionGrants(vault, fromBlock = SPENDGUARD_DEPLOY_BLOCK, toBlock) {
      const vaultAddr = requireAddress(vault, "vault");
      const end = toBlock ?? (await publicClient.getBlockNumber());
      const out: SessionGrantedEvent[] = [];
      for (let start = fromBlock; start <= end; start += AEVUM_LOG_CHUNK_BLOCKS + 1n) {
        const chunkEnd = start + AEVUM_LOG_CHUNK_BLOCKS > end ? end : start + AEVUM_LOG_CHUNK_BLOCKS;
        const logs = await publicClient.getLogs({
          address: vaultAddr,
          event: {
            type: "event",
            name: "SessionGranted",
            inputs: [
              { type: "address", name: "sessionKey", indexed: true },
              { type: "address[]", name: "recipients" },
              { type: "uint256", name: "maxPerTx" },
              { type: "uint256", name: "spendCap" },
              { type: "uint256", name: "expiresAt" },
            ],
          },
          fromBlock: start,
          toBlock: chunkEnd,
        });
        for (const log of logs) {
          out.push({
            sessionKey: log.args.sessionKey as Address,
            recipients: [...(log.args.recipients as Address[])],
            maxPerTx: log.args.maxPerTx as bigint,
            spendCap: log.args.spendCap as bigint,
            expiresAt: log.args.expiresAt as bigint,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
        }
      }
      return out;
    },

    async tokenBalance(owner) {
      return publicClient.readContract({
        address: TUSD8_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [requireAddress(owner, "owner")],
      });
    },

    async tokenAllowance(owner, spender) {
      return publicClient.readContract({
        address: TUSD8_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [requireAddress(owner, "owner"), requireAddress(spender, "spender")],
      });
    },
  };

  return client;
}

/**
 * Build a wallet client for a private key on Aevum testnet. Only use this
 * with a TEST wallet. Never pass a mainnet key, and never commit a key.
 */
export function createSpendGuardWalletClient(privateKey: `0x${string}`, rpcUrl: string = AEVUM_RPC_URL): WalletClient {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: aevumTestnet,
    transport: http(rpcUrl),
  });
}

/** Convert a human amount ("0.10") to base units (tUSD8 has 6 decimals). */
export function toBaseUnits(amount: string, decimals: number = TUSD8_DECIMALS): bigint {
  return parseUnits(amount, decimals);
}

/** Convert base units back to a human amount ("0.10"). */
export function fromBaseUnits(amount: bigint, decimals: number = TUSD8_DECIMALS): string {
  return formatUnits(amount, decimals);
}

/** Explorer link for a transaction hash. */
export function explorerTxUrl(hash: Hash): string {
  return `https://explorer-test.qday.info/tx/${hash}`;
}

/** Explorer link for an address. */
export function explorerAddressUrl(address: Address): string {
  return `https://explorer-test.qday.info/address/${address}`;
}
