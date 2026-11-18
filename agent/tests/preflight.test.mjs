import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePreflight } from "../agent.mjs";

const NOW = 1_790_000_000n;

function state(overrides = {}) {
  return {
    paused: false,
    sessionActive: true,
    expiresAt: NOW + 3600n,
    blockTimestamp: NOW,
    recipientAllowed: true,
    maxPerTx: 500_000n,
    spendCap: 1_000_000n,
    spent: 250_000n,
    remainingCap: 750_000n,
    vaultBalance: 2_750_000n,
    ...overrides,
  };
}

describe("evaluatePreflight", () => {
  it("passes a valid payment", () => {
    const decision = evaluatePreflight(state(), { amount: 250_000n });
    assert.equal(decision.ok, true);
    assert.deepEqual(decision.failures, []);
  });
  it("passes a payment exactly at the per-tx limit and remaining cap", () => {
    const decision = evaluatePreflight(state({ remainingCap: 500_000n }), { amount: 500_000n });
    assert.equal(decision.ok, true);
  });
  it("refuses when the vault is paused", () => {
    const decision = evaluatePreflight(state({ paused: true }), { amount: 100_000n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /paused/.test(f)));
  });
  it("refuses a key with no active session", () => {
    const decision = evaluatePreflight(
      state({ sessionActive: false, maxPerTx: 0n, remainingCap: 0n, spendCap: 0n, spent: 0n }),
      { amount: 100_000n }
    );
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /No active session/.test(f)));
  });
  it("refuses an expired session, including the exact expiry second", () => {
    const atExpiry = evaluatePreflight(state({ expiresAt: NOW }), { amount: 100_000n });
    assert.equal(atExpiry.ok, false);
    assert.ok(atExpiry.failures.some((f) => /expired/.test(f)));
    const pastExpiry = evaluatePreflight(state({ expiresAt: NOW - 1n }), { amount: 100_000n });
    assert.equal(pastExpiry.ok, false);
  });
  it("refuses a session expiring within the 60 second safety margin", () => {
    const decision = evaluatePreflight(state({ expiresAt: NOW + 30n }), { amount: 100_000n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /within 60 seconds/.test(f)));
  });
  it("passes a session expiring just outside the margin", () => {
    const decision = evaluatePreflight(state({ expiresAt: NOW + 61n }), { amount: 100_000n });
    assert.equal(decision.ok, true);
  });
  it("refuses a recipient who is not allowlisted", () => {
    const decision = evaluatePreflight(state({ recipientAllowed: false }), { amount: 100_000n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /not on this session allowlist/.test(f)));
  });
  it("refuses an amount above the per-payment limit", () => {
    const decision = evaluatePreflight(state(), { amount: 500_001n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /per-payment limit/.test(f)));
  });
  it("refuses an amount above the remaining cap", () => {
    const decision = evaluatePreflight(state({ maxPerTx: 1_000_000n, remainingCap: 300_000n }), { amount: 300_001n });
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /remaining cap/.test(f)));
  });
  it("refuses an amount above the vault balance", () => {
    const decision = evaluatePreflight(
      state({ maxPerTx: 5_000_000n, remainingCap: 5_000_000n, vaultBalance: 100_000n }),
      { amount: 100_001n }
    );
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.some((f) => /does not hold that much/.test(f)));
  });
  it("lists every failure at once", () => {
    const decision = evaluatePreflight(
      state({ paused: true, recipientAllowed: false, maxPerTx: 10n, remainingCap: 10n, vaultBalance: 10n }),
      { amount: 100_000n }
    );
    assert.equal(decision.ok, false);
    assert.ok(decision.failures.length >= 4);
  });
});
