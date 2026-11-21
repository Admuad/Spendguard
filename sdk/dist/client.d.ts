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
import { type Address, type Chain, type Hash, type PublicClient, type WalletClient } from "viem";
export declare const aevumTestnet: Chain;
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
export type SpendCheck = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
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
    createVault(): Promise<{
        vault: Address;
        transactionHash: Hash;
    }>;
    vaultsOf(owner: Address): Promise<Address[]>;
    vaultCount(): Promise<bigint>;
    allVaults(index: bigint): Promise<Address>;
    deposit(vault: Address, amount: bigint): Promise<{
        approveHash?: Hash;
        depositHash: Hash;
    }>;
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
export declare function createSpendGuardClient(options?: SpendGuardClientOptions): SpendGuardClient;
/**
 * Build a wallet client for a private key on Aevum testnet. Only use this
 * with a TEST wallet. Never pass a mainnet key, and never commit a key.
 */
export declare function createSpendGuardWalletClient(privateKey: `0x${string}`, rpcUrl?: string): WalletClient;
/** Convert a human amount ("0.10") to base units (tUSD8 has 6 decimals). */
export declare function toBaseUnits(amount: string, decimals?: number): bigint;
/** Convert base units back to a human amount ("0.10"). */
export declare function fromBaseUnits(amount: bigint, decimals?: number): string;
/** Explorer link for a transaction hash. */
export declare function explorerTxUrl(hash: Hash): string;
/** Explorer link for an address. */
export declare function explorerAddressUrl(address: Address): string;
//# sourceMappingURL=client.d.ts.map