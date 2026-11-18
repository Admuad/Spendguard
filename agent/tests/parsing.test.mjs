import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, formatAmount } from "../agent.mjs";

describe("parseAmount: valid inputs", () => {
  it("parses whole units", () => {
    assert.equal(parseAmount("1"), 1_000_000n);
    assert.equal(parseAmount("2"), 2_000_000n);
  });
  it("parses decimals up to 6 places", () => {
    assert.equal(parseAmount("0.25"), 250_000n);
    assert.equal(parseAmount("0.000001"), 1n);
    assert.equal(parseAmount("1.000001"), 1_000_001n);
    assert.equal(parseAmount("2.75"), 2_750_000n);
  });
  it("trims surrounding whitespace", () => {
    assert.equal(parseAmount("  0.25 "), 250_000n);
    assert.equal(parseAmount("\t1\n"), 1_000_000n);
  });
  it("parses large but in-range values exactly", () => {
    assert.equal(parseAmount("1000000000"), 1_000_000_000_000_000n);
    assert.equal(parseAmount("123456.123456"), 123_456_123_456n);
  });
});

describe("parseAmount: rejected inputs", () => {
  const bad = [
    "",
    "   ",
    "0",
    "0.00",
    "0.000000",
    "-1",
    "-0.25",
    "+1",
    "1e3",
    "1E3",
    "0.0000001",
    "1.1234567",
    "1,000",
    "1.2.3",
    ".5",
    "5.",
    "0x10",
    "NaN",
    "Infinity",
    "1_000",
    "0.25 tUSD8",
    "25%",
    "１２",
  ];
  for (const input of bad) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(parseAmount(input), null);
    });
  }
  it("rejects non-strings", () => {
    assert.equal(parseAmount(undefined), null);
    assert.equal(parseAmount(null), null);
    assert.equal(parseAmount(0.25), null);
    assert.equal(parseAmount(1n), null);
  });
  it("rejects values above uint256 max", () => {
    // 2^256 - 1 in base units is about 1.1579e71; this is far above it.
    assert.equal(parseAmount("115792089237316195423570985008687907853269984665640564039457584007913129639936"), null);
  });
});

describe("formatAmount", () => {
  it("round-trips parsed amounts", () => {
    for (const input of ["0.25", "1", "0.000001", "2.75", "1000000000"]) {
      assert.equal(formatAmount(parseAmount(input)), input);
    }
  });
  it("formats zero and trailing zeros", () => {
    assert.equal(formatAmount(0n), "0");
    assert.equal(formatAmount(1_000_000n), "1");
    assert.equal(formatAmount(1_500_000n), "1.5");
    assert.equal(formatAmount(1_000_001n), "1.000001");
  });
});
