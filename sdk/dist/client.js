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
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, formatUnits, getAddress, http, isAddress, parseUnits, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AEVUM_CHAIN_ID, AEVUM_LOG_CHUNK_BLOCKS, AEVUM_RPC_URL, AEVUM_TX_TYPE, DEFAULT_GAS_FUND_AMOUNT, SPENDGUARD_DEPLOY_BLOCK, SPENDGUARD_FACTORY_ADDRESS, TUSD8_ADDRESS, TUSD8_DECIMALS, } from "./constants.js";
import { erc20Abi, spendGuardAbi, spendGuardFactoryAbi } from "./abi.js";
export const aevumTestnet = defineChain({
    id: AEVUM_CHAIN_ID,
    name: "QDay Aevum Testnet",
    nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
    rpcUrls: { default: { http: [AEVUM_RPC_URL] } },
    blockExplorers: {
        default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" },
    },
});
function requireWallet(client) {
    if (!client.walletClient) {
        throw new Error("This call writes to the chain and needs a wallet client. Pass walletClient to createSpendGuardClient, or use createSpendGuardWalletClient.");
    }
    return client.walletClient;
}
function requireAccount(client) {
    const account = requireWallet(client).account;
    if (!account)
        throw new Error("Wallet client has no account");
    return account;
}
function requireAddress(value, label) {
    if (!isAddress(value))
        throw new Error(`${label} is not a valid address: ${value}`);
    return getAddress(value);
}
async function writeAndWait(client, params) {
    const wallet = requireWallet(client);
    const hash = await wallet.writeContract({
        ...params,
        chain: aevumTestnet,
        type: AEVUM_TX_TYPE,
    });
    const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
        throw new Error(`Transaction reverted: ${hash}`);
    return hash;
}
async function sendNativeAndWait(client, to, value) {
    const wallet = requireWallet(client);
    const account = requireAccount(client);
    const hash = await wallet.sendTransaction({
        account,
        to,
        value,
        chain: aevumTestnet,
        type: AEVUM_TX_TYPE,
    });
    const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
        throw new Error(`Transaction reverted: ${hash}`);
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
export function createSpendGuardClient(options = {}) {
    const rpcUrl = options.rpcUrl ?? AEVUM_RPC_URL;
    const publicClient = options.publicClient ??
        createPublicClient({ chain: aevumTestnet, transport: http(rpcUrl) });
    const factoryAddress = options.factoryAddress ?? SPENDGUARD_FACTORY_ADDRESS;
    const client = {
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
                        return { vault: decoded.args.vault, transactionHash: hash };
                    }
                }
                catch {
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
            if (amount <= 0n)
                throw new Error("Deposit amount must be greater than zero");
            const account = requireAccount(client);
            const allowance = await client.tokenAllowance(account.address, vaultAddr);
            let approveHash;
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
        async grantSession(vault, grant, options = {}) {
            const wallet = requireWallet(client);
            const vaultAddr = requireAddress(vault, "vault");
            const sessionKey = requireAddress(grant.sessionKey, "sessionKey");
            // Validate the funding amount before the grant goes on-chain, so a
            // bad amount never leaves a granted-but-unfunded session behind.
            const gasFundAmount = options.gasFundAmount ?? DEFAULT_GAS_FUND_AMOUNT;
            if (options.fundGas && gasFundAmount <= 0n) {
                throw new Error("gasFundAmount must be greater than zero");
            }
            const grantHash = await writeAndWait(client, {
                address: vaultAddr,
                abi: spendGuardAbi,
                functionName: "grantSession",
                args: [
                    sessionKey,
                    grant.recipients.map((r) => requireAddress(r, "recipient")),
                    grant.maxPerTx,
                    grant.spendCap,
                    grant.expiresAt,
                ],
                account: requireAccount(client),
            });
            let gasFundHash;
            if (options.fundGas) {
                // Plain native transfer, sent after the grant confirms. The key
                // pays its own gas, so without this it cannot pay at all.
                gasFundHash = await sendNativeAndWait(client, sessionKey, gasFundAmount);
            }
            return { grantHash, gasFundHash };
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
            if (amount <= 0n)
                return { ok: false, reason: "Amount must be greater than zero" };
            if (await client.isPaused(vaultAddr))
                return { ok: false, reason: "Vault is paused" };
            const session = await client.getSession(vaultAddr, key);
            if (!session.active)
                return { ok: false, reason: "Session is not active (revoked or never granted)" };
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
            const out = [];
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
                        sessionKey: log.args.sessionKey,
                        recipient: log.args.recipient,
                        amount: log.args.amount,
                        newSpent: log.args.newSpent,
                        remainingCap: log.args.remainingCap,
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
            const out = [];
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
                        sessionKey: log.args.sessionKey,
                        recipients: [...log.args.recipients],
                        maxPerTx: log.args.maxPerTx,
                        spendCap: log.args.spendCap,
                        expiresAt: log.args.expiresAt,
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
export function createSpendGuardWalletClient(privateKey, rpcUrl = AEVUM_RPC_URL) {
    const account = privateKeyToAccount(privateKey);
    return createWalletClient({
        account,
        chain: aevumTestnet,
        transport: http(rpcUrl),
    });
}
/** Convert a human amount ("0.10") to base units (tUSD8 has 6 decimals). */
export function toBaseUnits(amount, decimals = TUSD8_DECIMALS) {
    return parseUnits(amount, decimals);
}
/** Convert base units back to a human amount ("0.10"). */
export function fromBaseUnits(amount, decimals = TUSD8_DECIMALS) {
    return formatUnits(amount, decimals);
}
/** Explorer link for a transaction hash. */
export function explorerTxUrl(hash) {
    return `https://explorer-test.qday.info/tx/${hash}`;
}
/** Explorer link for an address. */
export function explorerAddressUrl(address) {
    return `https://explorer-test.qday.info/address/${address}`;
}
//# sourceMappingURL=client.js.map