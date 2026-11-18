import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..", "agent.mjs");
const RECIPIENT = "0xE5e31bAB0976A568f009980Ed1da2B6A56D8D898";

let dir;
let ledger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "spendguard-cli-"));
  ledger = join(dir, "ledger.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [AGENT, ...args],
      { env: { ...process.env, ...env }, timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

function assertNoLeak(output, key) {
  assert.ok(!output.includes(key), "output contains the full private key");
  assert.ok(!output.includes(key.slice(2, 14)), "output contains the start of the private key");
  assert.ok(!output.includes(key.slice(-12)), "output contains the end of the private key");
  assert.ok(!output.includes("SESSION_KEY_PRIVATE_KEY=0x"), "output contains the raw env assignment");
}

describe("CLI behaviour", { timeout: 60_000 }, () => {
  it("--help exits 0 and prints usage", async () => {
    const { code, stdout } = await runCli(["--help"], {});
    assert.equal(code, 0);
    assert.match(stdout, /SpendGuard demo agent/);
    assert.match(stdout, /--dry-run/);
  });

  it("missing env fails closed with exit code 2", async () => {
    const { code, stderr } = await runCli(["--dry-run"], { AGENT_LEDGER_PATH: ledger });
    assert.equal(code, 2);
    assert.match(stderr, /SESSION_KEY_PRIVATE_KEY is not set/);
  });

  it("a dry run for a key with no session is refused, sends nothing, and leaks nothing", async () => {
    const key = generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    const { code, stdout, stderr } = await runCli(
      ["--dry-run"],
      {
        SESSION_KEY_PRIVATE_KEY: key,
        AGENT_RECIPIENT: RECIPIENT,
        AGENT_AMOUNT: "0.10",
        AGENT_INVOICE_ID: "cli-test-001",
        AGENT_LEDGER_PATH: ledger,
      }
    );
    assert.equal(code, 2);
    const output = stdout + stderr;
    assert.match(output, /No active session/);
    assert.ok(output.includes(address), "output should name the session key address");
    assertNoLeak(output, key);
    assert.equal(existsSync(ledger), false, "a refused dry run must not create a ledger file");
    assert.equal(existsSync(`${ledger}.lock`), false, "the lock must be released");
  });

  it("a dry run never consumes an invoice ID", async () => {
    const key = generatePrivateKey();
    const env = {
      SESSION_KEY_PRIVATE_KEY: key,
      AGENT_RECIPIENT: RECIPIENT,
      AGENT_AMOUNT: "0.10",
      AGENT_INVOICE_ID: "cli-test-002",
      AGENT_LEDGER_PATH: ledger,
    };
    await runCli(["--dry-run"], env);
    await runCli(["--dry-run"], env);
    assert.equal(existsSync(ledger), false, "dry runs must never write the ledger");
  });

  it("an already-paid invoice is refused before any chain read", async () => {
    const key = generatePrivateKey();
    writeFileSync(
      ledger,
      `${JSON.stringify({
        invoiceId: "cli-test-003",
        sessionKey: "0x0000000000000000000000000000000000000001",
        recipient: RECIPIENT,
        amount: "100000",
        amountDisplay: "0.10 tUSD8",
        txHash: "0xdeadbeef",
        status: "confirmed",
        at: new Date().toISOString(),
      })}\n`
    );
    const { code, stdout, stderr } = await runCli(
      ["--dry-run"],
      {
        SESSION_KEY_PRIVATE_KEY: key,
        AGENT_RECIPIENT: RECIPIENT,
        AGENT_AMOUNT: "0.10",
        AGENT_INVOICE_ID: "cli-test-003",
        AGENT_LEDGER_PATH: ledger,
      }
    );
    assert.equal(code, 2);
    assert.match(stdout + stderr, /already paid/);
    assertNoLeak(stdout + stderr, key);
  });

  it("a corrupt ledger fails closed", async () => {
    const key = generatePrivateKey();
    writeFileSync(ledger, "not json\n");
    const { code, stderr } = await runCli(
      ["--dry-run"],
      {
        SESSION_KEY_PRIVATE_KEY: key,
        AGENT_RECIPIENT: RECIPIENT,
        AGENT_AMOUNT: "0.10",
        AGENT_INVOICE_ID: "cli-test-004",
        AGENT_LEDGER_PATH: ledger,
      }
    );
    assert.equal(code, 2);
    assert.match(stderr, /ledger file .* is corrupt/);
  });

  it("a held lock refuses a second run", async () => {
    const key = generatePrivateKey();
    writeFileSync(`${ledger}.lock`, JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
    const { code, stderr } = await runCli(
      ["--dry-run"],
      {
        SESSION_KEY_PRIVATE_KEY: key,
        AGENT_RECIPIENT: RECIPIENT,
        AGENT_AMOUNT: "0.10",
        AGENT_INVOICE_ID: "cli-test-005",
        AGENT_LEDGER_PATH: ledger,
      }
    );
    assert.equal(code, 2);
    assert.match(stderr, /holds the lock/);
  });

  it("a stale lock is cleared and the run proceeds", async () => {
    const key = generatePrivateKey();
    writeFileSync(`${ledger}.lock`, JSON.stringify({ pid: 999999, at: "2020-01-01T00:00:00.000Z" }));
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(`${ledger}.lock`, old, old);
    const { code, stdout, stderr } = await runCli(
      ["--dry-run"],
      {
        SESSION_KEY_PRIVATE_KEY: key,
        AGENT_RECIPIENT: RECIPIENT,
        AGENT_AMOUNT: "0.10",
        AGENT_INVOICE_ID: "cli-test-006",
        AGENT_LEDGER_PATH: ledger,
      }
    );
    // Proceeds past the lock, then refuses on the missing session.
    assert.equal(code, 2);
    assert.match(stdout + stderr, /No active session/);
    assert.equal(existsSync(`${ledger}.lock`), false, "the stale lock must be cleaned up");
  });
});
