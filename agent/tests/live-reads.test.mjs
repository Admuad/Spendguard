import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPublicClientFor,
  fetchPreflightState,
  evaluatePreflight,
  assertChainId,
  DEFAULT_RPC_URL,
  DEFAULT_VAULT_ADDRESS,
} from "../agent.mjs";

// Read-only matrix against the live Aevum testnet. No private key is used
// and no transaction is sent: the tests read real session state and run it
// through the same pre-flight decision function the agent uses.
//
// Known sessions (18 Nov 2026):
//   live demo key: 0x8b473F82D8371345F9572b956Def5602D8fD36d1, cap 1.00,
//     per-tx 0.50, recipient = testnet wallet, expires ~19 Nov 07:03 WAT.
//   revoked key: 0x0EeB488140af0b7543c491Ee298F4943A5113E6c, revoked after
//     the end-to-end test; its remaining cap reads nonzero but it is dead.

const LIVE_KEY = "0x8b473F82D8371345F9572b956Def5602D8fD36d1";
const REVOKED_KEY = "0x0EeB488140af0b7543c491Ee298F4943A5113E6c";
const TESTNET_WALLET = "0xE5e31bAB0976A568f009980Ed1da2B6A56D8D898";
const STRANGER = "0x000000000000000000000000000000000000dEaD";
const NEVER_GRANTED = "0x0000000000000000000000000000000000000001";

const client = createPublicClientFor(DEFAULT_RPC_URL);

describe("live chain reads (read-only)", { timeout: 30_000 }, () => {
  it("the RPC reports chain 44005", async () => {
    const chainId = await client.getChainId();
    assert.equal(chainId, 44005);
    assert.doesNotThrow(() => assertChainId(chainId));
  });

  it("reads the live demo session state", async () => {
    const state = await fetchPreflightState(client, DEFAULT_VAULT_ADDRESS, LIVE_KEY, TESTNET_WALLET);
    assert.equal(state.paused, false);
    assert.equal(state.sessionActive, true);
    assert.equal(state.recipientAllowed, true);
    assert.equal(state.maxPerTx, 500_000n);
    assert.equal(state.spendCap, 1_000_000n);
    assert.ok(state.remainingCap > 0n, "demo session should still have cap left");
    assert.ok(state.vaultBalance > 0n, "vault should hold funds");
    assert.ok(state.expiresAt > state.blockTimestamp, "demo session should be unexpired at test time");
  });

  it("a valid intent against the live session passes pre-flight", async () => {
    const state = await fetchPreflightState(client, DEFAULT_VAULT_ADDRESS, LIVE_KEY, TESTNET_WALLET);
    const decision = evaluatePreflight(state, { amount: 100_000n });
    assert.equal(decision.ok, true);
    assert.deepEqual(decision.failures, []);
  });

  it("an over-cap intent against the live session is refused", async () => {
    const state = await fetchPreflightState(client, DEFAULT_VAULT_ADDRESS, LIVE_KEY, TESTNET_WALLET);
    const decision = evaluatePreflight(state, { amount: 600_000n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /per-payment limit/.test(f)));
  });

  it("a non-allowlisted recipient against the live session is refused", async () => {
    const state = await fetchPreflightState(client, DEFAULT_VAULT_ADDRESS, LIVE_KEY, STRANGER);
    assert.equal(state.recipientAllowed, false);
    const decision = evaluatePreflight(state, { amount: 100_000n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /not on this session allowlist/.test(f)));
  });

  it("the revoked key is refused even though its remaining cap reads nonzero", async () => {
    const state = await fetchPreflightState(client, DEFAULT_VAULT_ADDRESS, REVOKED_KEY, TESTNET_WALLET);
    assert.equal(state.sessionActive, false);
    assert.ok(state.remainingCap > 0n, "revoked session keeps a nonzero remaining cap on-chain");
    const decision = evaluatePreflight(state, { amount: 100_000n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /No active session/.test(f)));
  });

  it("a never-granted key is refused", async () => {
    const state = await fetchPreflightState(client, DEFAULT_VAULT_ADDRESS, NEVER_GRANTED, TESTNET_WALLET);
    assert.equal(state.sessionActive, false);
    assert.equal(state.maxPerTx, 0n);
    assert.equal(state.remainingCap, 0n);
    const decision = evaluatePreflight(state, { amount: 100_000n });
    assert.equal(decision.ok, false);
  });
});
