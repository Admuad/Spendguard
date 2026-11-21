/**
 * spendguard-sdk: scoped session-key vaults for tUSD8 on Aevum testnet.
 *
 * Owner flow:
 * ```ts
 * const owner = createSpendGuardClient({ walletClient: ownerWallet });
 * const { vault } = await owner.createVault();
 * await owner.deposit(vault, toBaseUnits("3.00"));
 * await owner.grantSession(vault, {
 *   sessionKey: agentAddress,
 *   recipients: [merchantAddress],
 *   maxPerTx: toBaseUnits("0.10"),
 *   spendCap: toBaseUnits("1.00"),
 *   expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
 * });
 * ```
 *
 * Agent flow (the agent holds only a session key):
 * ```ts
 * const agent = createSpendGuardClient({ walletClient: agentWallet });
 * const check = await agent.canSpend(vault, agentAddress, merchantAddress, toBaseUnits("0.05"));
 * if (check.ok) await agent.executePayment(vault, agentAddress, merchantAddress, toBaseUnits("0.05"));
 * ```
 */
export { erc20Abi, spendGuardAbi, spendGuardFactoryAbi } from "./abi.js";
export { AEVUM_CHAIN_ID, AEVUM_EXPLORER_URL, AEVUM_LOG_CHUNK_BLOCKS, AEVUM_RPC_URL, AEVUM_TX_TYPE, SPENDGUARD_DEMO_VAULT_ADDRESS, SPENDGUARD_DEPLOY_BLOCK, SPENDGUARD_FACTORY_ADDRESS, TUSD8_ADDRESS, TUSD8_DECIMALS, } from "./constants.js";
export { aevumTestnet, createSpendGuardClient, createSpendGuardWalletClient, explorerAddressUrl, explorerTxUrl, fromBaseUnits, toBaseUnits, type Payment, type Session, type SessionGrant, type SessionGrantedEvent, type SpendCheck, type SpendGuardClient, type SpendGuardClientOptions, } from "./client.js";
//# sourceMappingURL=index.d.ts.map