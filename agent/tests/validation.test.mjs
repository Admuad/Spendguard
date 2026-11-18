import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, Refusal, AGENT_ABI_SIGNATURES } from "../agent.mjs";

const KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const RECIPIENT = "0xE5e31bAB0976A568f009980Ed1da2B6A56D8D898";

function validEnv(overrides = {}) {
  return {
    SESSION_KEY_PRIVATE_KEY: KEY,
    AGENT_RECIPIENT: RECIPIENT,
    AGENT_AMOUNT: "0.25",
    AGENT_INVOICE_ID: "invoice-001",
    ...overrides,
  };
}

function refusalMessage(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof Refusal, `expected Refusal, got ${error}`);
    return error.message;
  }
  assert.fail("expected a Refusal to be thrown");
}

describe("loadConfig: valid input", () => {
  it("loads with defaults", () => {
    const config = loadConfig(validEnv());
    assert.equal(config.amount, 250_000n);
    assert.equal(config.rpcUrl, "https://rpc-test.qday.info");
    assert.equal(config.vaultAddress, "0x048a64225419C11C9Ff0CB39aA925902c5e965Ac");
    assert.equal(config.ledgerPath, "agent-ledger.jsonl");
    assert.equal(config.dryRun, false);
  });
  it("accepts --dry-run and --ledger", () => {
    const config = loadConfig(validEnv(), ["--dry-run", "--ledger", "/tmp/x.jsonl"]);
    assert.equal(config.dryRun, true);
    assert.equal(config.ledgerPath, "/tmp/x.jsonl");
  });
  it("accepts env overrides for RPC, vault, and ledger", () => {
    const config = loadConfig(
      validEnv({ RPC_URL: "https://example.invalid", VAULT_ADDRESS: RECIPIENT, AGENT_LEDGER_PATH: "custom.jsonl" })
    );
    assert.equal(config.rpcUrl, "https://example.invalid");
    assert.equal(config.vaultAddress, RECIPIENT);
    assert.equal(config.ledgerPath, "custom.jsonl");
  });
});

describe("loadConfig: missing values fail closed", () => {
  it("requires the session key", () => {
    const env = validEnv();
    delete env.SESSION_KEY_PRIVATE_KEY;
    assert.match(refusalMessage(() => loadConfig(env)), /SESSION_KEY_PRIVATE_KEY is not set/);
  });
  it("requires the recipient", () => {
    const env = validEnv();
    delete env.AGENT_RECIPIENT;
    assert.match(refusalMessage(() => loadConfig(env)), /AGENT_RECIPIENT is not set/);
  });
  it("requires the amount", () => {
    const env = validEnv();
    delete env.AGENT_AMOUNT;
    assert.match(refusalMessage(() => loadConfig(env)), /AGENT_AMOUNT is not set/);
  });
  it("requires the invoice ID", () => {
    const env = validEnv();
    delete env.AGENT_INVOICE_ID;
    assert.match(refusalMessage(() => loadConfig(env)), /AGENT_INVOICE_ID is not set/);
  });
});

describe("loadConfig: malformed values fail closed", () => {
  it("rejects malformed private keys", () => {
    for (const bad of [
      "1234",
      "0x1234",
      `0x${"0".repeat(64)}`,
      `0x${"zz".repeat(32)}`,
      `0x${"ab".repeat(31)}`,
      `0x${"ab".repeat(33)}`,
      "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    ]) {
      assert.match(
        refusalMessage(() => loadConfig(validEnv({ SESSION_KEY_PRIVATE_KEY: bad }))),
        /SESSION_KEY_PRIVATE_KEY is malformed/
      );
    }
  });
  it("rejects an invalid recipient", () => {
    assert.match(
      refusalMessage(() => loadConfig(validEnv({ AGENT_RECIPIENT: "not-an-address" }))),
      /AGENT_RECIPIENT is not a valid address/
    );
  });
  it("rejects invalid amounts", () => {
    for (const bad of ["0", "-1", "1e3", "0.0000001", "abc"]) {
      assert.match(
        refusalMessage(() => loadConfig(validEnv({ AGENT_AMOUNT: bad }))),
        /AGENT_AMOUNT is not a valid/
      );
    }
  });
  it("rejects invalid invoice IDs, including ledger-injection shapes", () => {
    for (const bad of [
      "has space",
      "has\nnewline",
      "has\ttab",
      "-starts-with-dash",
      ".starts-with-dot",
      "a".repeat(129),
      'quote"break',
      "back\\slash",
    ]) {
      assert.match(
        refusalMessage(() => loadConfig(validEnv({ AGENT_INVOICE_ID: bad }))),
        /AGENT_INVOICE_ID is invalid/
      );
    }
  });
  it("treats an empty invoice ID as missing", () => {
    assert.match(
      refusalMessage(() => loadConfig(validEnv({ AGENT_INVOICE_ID: "" }))),
      /AGENT_INVOICE_ID is not set/
    );
  });
  it("rejects a non-http RPC URL", () => {
    assert.match(
      refusalMessage(() => loadConfig(validEnv({ RPC_URL: "ftp://example.invalid" }))),
      /RPC_URL is not a valid/
    );
  });
  it("rejects an invalid vault address", () => {
    assert.match(
      refusalMessage(() => loadConfig(validEnv({ VAULT_ADDRESS: "0x1234" }))),
      /VAULT_ADDRESS is not a valid address/
    );
  });
  it("rejects unknown CLI arguments", () => {
    assert.match(refusalMessage(() => loadConfig(validEnv(), ["--pay"])), /Unknown argument/);
    assert.match(refusalMessage(() => loadConfig(validEnv(), ["--ledger"])), /--ledger needs a file path/);
  });
});

describe("loadConfig: no secret in any message", () => {
  it("never echoes the private key in an error", () => {
    const messages = [];
    for (const bad of [`0x${"zz".repeat(32)}`, "short"]) {
      messages.push(refusalMessage(() => loadConfig(validEnv({ SESSION_KEY_PRIVATE_KEY: bad }))));
    }
    // Even the valid-key config path must not leak through other errors.
    messages.push(refusalMessage(() => loadConfig(validEnv({ AGENT_RECIPIENT: "bad" }))));
    for (const message of messages) {
      assert.ok(!message.includes(KEY), "error message contains key material");
      assert.ok(!message.includes(KEY.slice(2, 12)), "error message contains key fragment");
    }
  });
});

describe("agent ABI: deliberately narrow", () => {
  it("contains no admin or deposit function", () => {
    const joined = AGENT_ABI_SIGNATURES.join("\n");
    for (const forbidden of ["grantSession", "revokeSession", "pause", "unpause", "ownerWithdraw", "deposit", "transferOwnership"]) {
      assert.ok(!joined.includes(`function ${forbidden}(`), `ABI must not contain ${forbidden}`);
    }
  });
  it("contains exactly the reads plus executePayment", () => {
    const names = AGENT_ABI_SIGNATURES.map((s) => s.match(/function (\w+)/)[1]).sort();
    assert.deepEqual(names, ["executePayment", "getSession", "isRecipientAllowed", "paused", "remainingCap", "vaultBalance"]);
  });
});
