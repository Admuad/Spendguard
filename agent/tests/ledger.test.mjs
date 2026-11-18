import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedgerEntries, findLatestEntry, isInvoicePayable, appendLedgerEntry, Refusal } from "../agent.mjs";

let dir;
let ledger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "spendguard-ledger-"));
  ledger = join(dir, "ledger.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entry(invoiceId, status, txHash = "0xabc") {
  return {
    invoiceId,
    sessionKey: "0x0000000000000000000000000000000000000001",
    recipient: "0x0000000000000000000000000000000000000002",
    amount: "250000",
    amountDisplay: "0.25 tUSD8",
    txHash,
    status,
    at: new Date().toISOString(),
  };
}

describe("idempotency ledger", () => {
  it("treats a missing ledger as empty", () => {
    assert.deepEqual(readLedgerEntries(ledger), []);
    assert.equal(isInvoicePayable([], "invoice-1"), true);
  });
  it("records and finds entries", () => {
    appendLedgerEntry(ledger, entry("invoice-1", "submitted"));
    appendLedgerEntry(ledger, entry("invoice-1", "confirmed"));
    appendLedgerEntry(ledger, entry("invoice-2", "submitted"));
    const entries = readLedgerEntries(ledger);
    assert.equal(entries.length, 3);
    assert.equal(findLatestEntry(entries, "invoice-1").status, "confirmed");
    assert.equal(findLatestEntry(entries, "invoice-2").status, "submitted");
    assert.equal(findLatestEntry(entries, "invoice-3"), null);
  });
  it("refuses a duplicate invoice: submitted or confirmed blocks", () => {
    assert.equal(isInvoicePayable([entry("invoice-1", "submitted")], "invoice-1"), false);
    assert.equal(isInvoicePayable([entry("invoice-1", "confirmed")], "invoice-1"), false);
    assert.equal(isInvoicePayable([entry("invoice-1", "submitted"), entry("invoice-1", "confirmed")], "invoice-1"), false);
  });
  it("allows retry after a revert, since no funds moved", () => {
    assert.equal(isInvoicePayable([entry("invoice-1", "reverted")], "invoice-1"), true);
    assert.equal(
      isInvoicePayable([entry("invoice-1", "reverted"), entry("invoice-1", "submitted")], "invoice-1"),
      false
    );
  });
  it("does not confuse different invoice IDs", () => {
    const entries = [entry("invoice-1", "confirmed")];
    assert.equal(isInvoicePayable(entries, "invoice-2"), true);
    assert.equal(isInvoicePayable(entries, "invoice-1-extra"), true);
  });
  it("skips blank lines", () => {
    writeFileSync(ledger, "\n\n");
    appendLedgerEntry(ledger, entry("invoice-1", "confirmed"));
    writeFileSync(ledger, `${readFileSync(ledger, "utf8")}\n`, "utf8");
    assert.equal(readLedgerEntries(ledger).length, 1);
  });
  it("fails closed on a corrupt line", () => {
    writeFileSync(ledger, '{"invoiceId":"invoice-1","status":"confirmed"}\nthis is not json\n');
    assert.throws(() => readLedgerEntries(ledger), Refusal);
  });
  it("fails closed on a wrongly shaped line", () => {
    writeFileSync(ledger, '{"nope":true}\n');
    assert.throws(() => readLedgerEntries(ledger), Refusal);
    writeFileSync(ledger, '"just a string"\n');
    assert.throws(() => readLedgerEntries(ledger), Refusal);
  });
  it("never stores key material", () => {
    const secret = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    appendLedgerEntry(ledger, entry("invoice-1", "confirmed"));
    const text = readFileSync(ledger, "utf8");
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes("PRIVATE_KEY"));
  });
});
