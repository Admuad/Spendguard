# SpendGuard demo agent

A small program that pays a merchant from the SpendGuard vault using only a
scoped session key. It is the "agent" in the SpendGuard story: a bot, a
cashier script, or an AI assistant that holds a bounded key, not the vault,
not the owner key.

The agent never holds the owner key. It cannot grant, revoke, pause,
deposit, or sweep. The only contract call it can make is `executePayment`,
and the contract enforces the session bounds on-chain even if this script
is wrong. The script adds a readable second layer: it checks every bound
before sending and refuses in plain language when anything is off.

## Setup

Prerequisites: Node 20 or newer. No build step.

```sh
cd agent
npm install
```

## The grant flow (do this first)

The agent key starts with no power. The vault owner grants it a session,
either in the web UI (Grant panel) or with a contract call. The grant names:

1. The agent key address (the address that matches `SESSION_KEY_PRIVATE_KEY`).
2. The allowed recipients (the merchants this key may pay, nothing else).
3. The per-payment limit and the total spend cap.
4. The expiry.

The owner can revoke the session at any time, instantly, from the UI. A
revoked key can never spend again. To change a grant's bounds, the owner
edits it from the sessions list: the edit re-specifies the recipients,
per-tx limit, cap, and expiry while the amount already spent is preserved,
and the cap can never drop below what the key has already spent. Only a
fresh grant after a revoke starts with zero spent.

The agent key also needs a little tQDAY for gas. It holds no tUSD8 and
never needs any: payments come out of the vault, not out of the key.

Each user creates their own vault through the SpendGuard factory
(`0x3BD7Ffda8504124fb7aE9e28DCA0D01aA5A728EE` on the Aevum testnet). Point
the agent at your vault with `VAULT_ADDRESS`. The default is the demo
vault above.

## Dry run (no transaction, always safe)

```sh
SESSION_KEY_PRIVATE_KEY=0x... \
AGENT_RECIPIENT=0x... \
AGENT_AMOUNT=0.25 \
AGENT_INVOICE_ID=invoice-001 \
node agent.mjs --dry-run
```

A dry run performs every check, prints exactly what would be sent, and
sends nothing. It does not touch the idempotency ledger, so a dry run never
consumes an invoice ID. Run it first, every time.

## Live run

```sh
SESSION_KEY_PRIVATE_KEY=0x... \
AGENT_RECIPIENT=0x... \
AGENT_AMOUNT=0.25 \
AGENT_INVOICE_ID=invoice-001 \
node agent.mjs
```

The agent checks the chain, the vault, and the session, estimates gas,
sends one legacy transaction, waits for the receipt, and prints the
explorer link. Exit codes: 0 means paid (or dry-run passed), 2 means
refused (nothing was sent), 1 means an error or an unconfirmed transaction.

## How double payment is prevented

Every payment carries an invoice ID. Paid invoice IDs are recorded in
`agent-ledger.jsonl` (one JSON line per attempt). The agent refuses to pay
an invoice ID that is already recorded as submitted or confirmed. An
invoice whose payment reverted on-chain may be retried: a reverted payment
moved no funds.

The send itself uses a pinned nonce with at most one retry, so a retry can
never create a second payment if the first attempt actually landed. If a
send fails ambiguously (no hash returned, but the nonce was consumed), the
agent stops and tells you to check the explorer instead of guessing. See
AGENT-SECURITY.md for the full reasoning and the residual risks.

## Security model in plain language

- One secret, one place. The session key lives only in the environment of
  the running process. It is never printed, never written to disk, and
  never committed. The ledger records addresses, amounts, and hashes only.
- The key is bounded. Even if the key is stolen, the thief can only pay
  allowlisted recipients, up to the remaining cap, before the expiry. The
  owner revokes the session to kill the key instantly, and can sweep the
  vault at any time, paused or not.
- Wrong chain, wrong vault, wrong amount: all refused. The agent only runs
  on chain 44005, parses amounts as exact integers (no floats), and checks
  the session state against the live chain before every send.
- The contract is the final judge. If anything changes between the checks
  and the mined transaction (a revoke, an expiry, a pause), the contract
  reverts the payment and no funds move.

The full audit, threat by threat, is in AGENT-SECURITY.md.

## If something goes wrong

- "Refused" with a reason: fix the cause (fresh grant, correct recipient,
  smaller amount, unpause) and retry. Nothing was sent.
- "Nonce was consumed" with no hash: do not rerun blindly. Open the
  explorer link for the session key address and check whether a payment
  landed. The contract cap bounds the damage either way.
- Receipt not confirmed in time: the payment is recorded as submitted and
  the invoice stays blocked. Check the explorer link printed by the run.
  If the transaction never landed, remove its line from the ledger only
  after confirming on the explorer that no payment exists for that invoice.
- Lock file held: only one agent run may use a ledger at a time. If no run
  is active, delete `agent-ledger.jsonl.lock` and retry. Locks older than
  5 minutes are treated as stale and cleared automatically.

## Tests

```sh
npm test
```

The suite covers amount parsing, environment validation, the chain guard,
the idempotency ledger, the pre-flight decision table, and a read-only
matrix against the live testnet. It sends no transactions.
