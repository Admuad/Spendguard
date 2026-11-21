/**
 * Network constants for SpendGuard on the QDay Aevum testnet.
 * Nothing here is a secret. These are the deployed addresses.
 */
/** Aevum testnet chain ID. */
export declare const AEVUM_CHAIN_ID = 44005;
/** Aevum testnet RPC (HTTPS only, no WebSocket). */
export declare const AEVUM_RPC_URL = "https://rpc-test.qday.info";
/** Aevum testnet explorer. */
export declare const AEVUM_EXPLORER_URL = "https://explorer-test.qday.info";
/** tUSD8 on Aevum testnet (6 decimals, USDC-style). */
export declare const TUSD8_ADDRESS: "0x456569838f1d43009A91ebA4263147Afd7233483";
/** tUSD8 decimals. */
export declare const TUSD8_DECIMALS = 6;
/** The deployed SpendGuard factory (18 Nov 2026). */
export declare const SPENDGUARD_FACTORY_ADDRESS: "0x3BD7Ffda8504124fb7aE9e28DCA0D01aA5A728EE";
/** The demo vault shown on the SpendGuard homepage (read-only for visitors). */
export declare const SPENDGUARD_DEMO_VAULT_ADDRESS: "0x048a64225419C11C9Ff0CB39aA925902c5e965Ac";
/** Block the factory was deployed at. Use as the start for log scans. */
export declare const SPENDGUARD_DEPLOY_BLOCK = 3492987n;
/**
 * Aevum caps eth_getLogs at 1,000 blocks per call. Every log scan in this
 * SDK chunks its range. See the Aevum starter-kit docs, "Differences from
 * Ethereum".
 */
export declare const AEVUM_LOG_CHUNK_BLOCKS = 1000n;
/** Aevum uses legacy (type 0) transactions. */
export declare const AEVUM_TX_TYPE: "legacy";
//# sourceMappingURL=constants.d.ts.map