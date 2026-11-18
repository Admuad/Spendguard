import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertChainId, Refusal, AEVUM_CHAIN_ID } from "../agent.mjs";

describe("chain guard", () => {
  it("accepts exactly chain 44005", () => {
    assert.doesNotThrow(() => assertChainId(44005));
    assert.equal(AEVUM_CHAIN_ID, 44005);
  });
  it("rejects mainnet, other L2s, and the fork chain id trap", () => {
    for (const wrong of [1, 137, 10, 42161, 440050, 44006, 0, -1]) {
      assert.throws(
        () => assertChainId(wrong),
        (error) => error instanceof Refusal && /Wrong chain/.test(error.message),
        `chain ${wrong} must be refused`
      );
    }
  });
  it("rejects non-numeric chain ids", () => {
    for (const wrong of ["44005", null, undefined, NaN]) {
      assert.throws(() => assertChainId(wrong), Refusal);
    }
  });
});
