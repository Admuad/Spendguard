import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  extractDecisionJson,
  parsePayees,
  payeeNameForAddress,
  validateDecision,
} from "../llm-agent.mjs";
import { callPollinations, resolveProvider } from "../llm-providers.mjs";

const FREELANCER = "0x1111111111111111111111111111111111111111";
const DESIGNER = "0x2222222222222222222222222222222222222222";

function payees() {
  return new Map([
    ["freelancer", FREELANCER],
    ["designer", DESIGNER],
  ]);
}

function sessionState() {
  return {
    session: {
      maxPerTx: 500_000n,
      spendCap: 1_000_000n,
      spent: 100_000n,
      expiresAt: 1795338153n,
      active: true,
      recipients: [FREELANCER],
    },
    remainingCap: 900_000n,
    vaultBalance: 3_000_000n,
    paused: false,
  };
}

test("parsePayees: accepts a valid directory", () => {
  const parsed = parsePayees(JSON.stringify({ freelancer: FREELANCER, designer: DESIGNER }));
  assert.equal(parsed.get("freelancer"), FREELANCER);
  assert.equal(parsed.get("designer"), DESIGNER);
});

test("parsePayees: rejects missing, empty, and malformed input", () => {
  assert.throws(() => parsePayees(""), /AGENT_PAYEES is not set/);
  assert.throws(() => parsePayees("{}"), /empty/);
  assert.throws(() => parsePayees("not json"), /not valid JSON/);
  assert.throws(() => parsePayees("[]"), /must be a JSON object/);
  assert.throws(() => parsePayees(JSON.stringify({ freelancer: "not-an-address" })), /bad address/);
  assert.throws(() => parsePayees(JSON.stringify({ "": FREELANCER })), /bad payee name/);
});

test("payeeNameForAddress: matches case-insensitively", () => {
  assert.equal(payeeNameForAddress(payees(), FREELANCER.toLowerCase()), "freelancer");
  assert.equal(payeeNameForAddress(payees(), "0x3333333333333333333333333333333333333333"), null);
});

test("buildPrompt: carries the task, the payees, and the live limits", () => {
  const prompt = buildPrompt({ task: "pay the freelancer 0.10 tUSD8 for the logo", payees: payees(), ...sessionState() });
  assert.match(prompt, /pay the freelancer 0\.10 tUSD8 for the logo/);
  assert.match(prompt, /freelancer: 0x1111/);
  assert.match(prompt, /per-payment limit: 0\.5 tUSD8/);
  assert.match(prompt, /remaining cap: 0\.9 tUSD8/);
  assert.match(prompt, /vault balance: 3 tUSD8/);
  assert.match(prompt, /ONLY the JSON object/);
});

test("extractDecisionJson: plain JSON, fenced JSON, and prose-wrapped JSON", () => {
  const plain = extractDecisionJson('{"recipient": "0x1111111111111111111111111111111111111111", "amount": "0.10", "reason": "logo"}');
  assert.equal(plain.amount, "0.10");
  const fenced = extractDecisionJson('```json\n{"recipient": "0x1111111111111111111111111111111111111111", "amount": "0.10", "reason": "logo"}\n```');
  assert.equal(fenced.amount, "0.10");
  const prose = extractDecisionJson('Here is my decision: {"recipient": "0x1111111111111111111111111111111111111111", "amount": "0.10", "reason": "logo"} Hope that helps.');
  assert.equal(prose.amount, "0.10");
  assert.equal(extractDecisionJson("no json here"), null);
  assert.equal(extractDecisionJson('{"recipient": '), null);
  assert.equal(extractDecisionJson("[1, 2]"), null);
});

test("validateDecision: accepts a payment to a listed payee", () => {
  const decision = validateDecision(
    { recipient: FREELANCER, amount: "0.10", reason: "paid for the logo" },
    payees()
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.recipient, FREELANCER);
  assert.equal(decision.amount, 100_000n);
  assert.equal(decision.payeeName, "freelancer");
});

test("validateDecision: passes a model refusal through", () => {
  const decision = validateDecision({ refuse: true, reason: "No known payee was named." }, payees());
  assert.equal(decision.ok, false);
  assert.equal(decision.refused, true);
  assert.match(decision.reason, /No known payee/);
});

test("validateDecision: rejects an unknown recipient, a bad amount, and a bad address", () => {
  const unknown = validateDecision(
    { recipient: "0x3333333333333333333333333333333333333333", amount: "0.10", reason: "x" },
    payees()
  );
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /not in the payee directory/);

  const badAmount = validateDecision({ recipient: FREELANCER, amount: "ten", reason: "x" }, payees());
  assert.equal(badAmount.ok, false);
  assert.match(badAmount.reason, /not a valid positive/);

  const zero = validateDecision({ recipient: FREELANCER, amount: "0", reason: "x" }, payees());
  assert.equal(zero.ok, false);

  const badAddress = validateDecision({ recipient: "not-an-address", amount: "0.10", reason: "x" }, payees());
  assert.equal(badAddress.ok, false);
  assert.match(badAddress.reason, /not a valid address/);

  const noJson = validateDecision(null, payees());
  assert.equal(noJson.ok, false);
  assert.match(noJson.reason, /no valid JSON/);
});

test("callPollinations: returns the model text with a stubbed fetch", async () => {
  const stubFetch = async (url) => {
    assert.match(url, /^https:\/\/text\.pollinations\.ai\//);
    return { ok: true, status: 200, text: async () => '{"recipient": "0x1", "amount": "0.10"}' };
  };
  const text = await callPollinations("hello", { fetchImpl: stubFetch });
  assert.match(text, /recipient/);
});

test("callPollinations: fails closed on HTTP errors and empty replies", async () => {
  const badFetch = async () => ({ ok: false, status: 503, text: async () => "down" });
  await assert.rejects(() => callPollinations("hello", { fetchImpl: badFetch }), /HTTP 503/);
  const emptyFetch = async () => ({ ok: true, status: 200, text: async () => "   " });
  await assert.rejects(() => callPollinations("hello", { fetchImpl: emptyFetch }), /empty reply/);
});

test("resolveProvider: pollinations by default, openai needs a key, unknown names rejected", () => {
  assert.equal(resolveProvider(undefined, {}).name, "pollinations");
  assert.equal(resolveProvider("pollinations", {}).name, "pollinations");
  assert.equal(resolveProvider("openai", { OPENAI_API_KEY: "sk-test" }).name, "openai");
  assert.throws(() => resolveProvider("claude", {}), /Unknown LLM provider/);
});
