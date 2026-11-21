/**
 * Unit tests for spendguard-sdk. No network needed: these test the pure
 * helpers, the ABIs, and the client wiring. Run with `npm test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSpendGuardClient,
  explorerAddressUrl,
  explorerTxUrl,
  fromBaseUnits,
  spendGuardAbi,
  spendGuardFactoryAbi,
  toBaseUnits,
  TUSD8_ADDRESS,
  SPENDGUARD_FACTORY_ADDRESS,
  SPENDGUARD_DEMO_VAULT_ADDRESS,
  AEVUM_CHAIN_ID,
} from "../dist/index.js";

describe("amount helpers", () => {
  it("converts human amounts to base units and back", () => {
    assert.equal(toBaseUnits("3.00"), 3_000_000n);
    assert.equal(toBaseUnits("0.10"), 100_000n);
    assert.equal(toBaseUnits("0.000001"), 1n);
    assert.equal(fromBaseUnits(3_000_000n), "3");
    assert.equal(fromBaseUnits(100_000n), "0.1");
    assert.equal(fromBaseUnits(0n), "0");
  });

  it("round-trips through base units", () => {
    assert.equal(fromBaseUnits(toBaseUnits("1.00")), "1");
    assert.equal(fromBaseUnits(toBaseUnits("0.05")), "0.05");
    assert.equal(fromBaseUnits(toBaseUnits("12.345678")), "12.345678");
  });
});

describe("constants", () => {
  it("pins the Aevum testnet and the deployed addresses", () => {
    assert.equal(AEVUM_CHAIN_ID, 44005);
    assert.equal(TUSD8_ADDRESS, "0x456569838f1d43009A91ebA4263147Afd7233483");
    assert.equal(SPENDGUARD_FACTORY_ADDRESS, "0x3BD7Ffda8504124fb7aE9e28DCA0D01aA5A728EE");
    assert.equal(SPENDGUARD_DEMO_VAULT_ADDRESS, "0x048a64225419C11C9Ff0CB39aA925902c5e965Ac");
  });
});

describe("ABIs", () => {
  it("vault ABI has every function the SDK calls", () => {
    const names = new Set(spendGuardAbi.filter((e) => e.type === "function").map((e) => e.name));
    for (const fn of [
      "deposit", "grantSession", "editSession", "revokeSession", "executePayment",
      "ownerWithdraw", "pause", "unpause", "getSession", "isRecipientAllowed",
      "remainingCap", "vaultBalance", "paused", "owner", "token",
    ]) {
      assert.ok(names.has(fn), `vault ABI missing ${fn}`);
    }
  });

  it("factory ABI has every function the SDK calls", () => {
    const names = new Set(spendGuardFactoryAbi.filter((e) => e.type === "function").map((e) => e.name));
    for (const fn of ["createVault", "vaultsOf", "vaultCount", "allVaults", "token"]) {
      assert.ok(names.has(fn), `factory ABI missing ${fn}`);
    }
  });

  it("vault ABI has every event the SDK reads", () => {
    const names = new Set(spendGuardAbi.filter((e) => e.type === "event").map((e) => e.name));
    for (const ev of ["Deposit", "SessionGranted", "SessionEdited", "SessionRevoked", "PaymentExecuted", "OwnerWithdraw"]) {
      assert.ok(names.has(ev), `vault ABI missing event ${ev}`);
    }
  });
});

describe("explorer links", () => {
  it("builds tx and address URLs on the Aevum explorer", () => {
    assert.equal(
      explorerTxUrl("0x1234"),
      "https://explorer-test.qday.info/tx/0x1234",
    );
    assert.equal(
      explorerAddressUrl("0x048a64225419C11C9Ff0CB39aA925902c5e965Ac"),
      "https://explorer-test.qday.info/address/0x048a64225419C11C9Ff0CB39aA925902c5e965Ac",
    );
  });
});

describe("client wiring", () => {
  it("creates a read-only client without a wallet", () => {
    const client = createSpendGuardClient();
    assert.equal(client.factoryAddress, SPENDGUARD_FACTORY_ADDRESS);
    assert.equal(client.walletClient, undefined);
  });

  it("refuses writes without a wallet client, with a clear error", async () => {
    const client = createSpendGuardClient();
    await assert.rejects(
      () => client.createVault(),
      /needs a wallet client/,
    );
    await assert.rejects(
      () => client.revokeSession(SPENDGUARD_DEMO_VAULT_ADDRESS, SPENDGUARD_DEMO_VAULT_ADDRESS),
      /needs a wallet client/,
    );
  });

  it("rejects invalid addresses with a clear error", async () => {
    const client = createSpendGuardClient();
    await assert.rejects(
      () => client.vaultBalance("not-an-address"),
      /not a valid address/,
    );
    await assert.rejects(
      () => client.getSession(SPENDGUARD_DEMO_VAULT_ADDRESS, "0x1234"),
      /not a valid address/,
    );
  });
});
