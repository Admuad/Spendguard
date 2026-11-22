# SpendGuard

## What SpendGuard is

- SpendGuard is a scoped session-key vault for tUSD8 on the Aevum testnet.

- Give an AI agent a key, not your wallet. The key can only pay within bounds the owner sets.

- Create a vault, fund it, and grant a session key with a per-payment limit, a total spending cap, allowed recipients, and an expiry.

- The key can never withdraw, deposit, or exceed its cap. The owner can revoke a key, pause the vault, and sweep the balance at any time.

- Use chain 44005, RPC `https://rpc-test.qday.info`, and explorer `explorer-test.qday.info`.

- Use tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` with 6 decimals.

- Use factory `0x3BD7Ffda8504124fb7aE9e28DCA0D01aA5A728EE`.

- Use demo vault `0x048a64225419C11C9Ff0CB39aA925902c5e965Ac` for the public demo.

- Open the live app at `https://admuad.github.io/Spendguard/` or `https://spendguard-ivory.vercel.app`.

- Watch the demo video at `https://youtu.be/ZwRmUPXpKJ8`.

- Find the repo at `https://github.com/Admuad/Spendguard`. The contracts live in `src/`, the SDK in `sdk/`, the web app in `ui/`, and the demo agent in `agent/`.

## Use the SDK

- Install the SDK with `npm install spendguard-sdk viem`. Node 20 or newer is required.

- Import `createSpendGuardClient`, `createSpendGuardWalletClient`, and `toBaseUnits` from `spendguard-sdk`.

- Create a read-only client with no arguments to read state and history.

- Create a wallet client from a test private key to send transactions. Use test keys only.

- Call `createVault` to deploy a new vault for the owner. It returns the vault address and the transaction hash.

- Call `deposit` to fund a vault with tUSD8. It approves exactly the deposit amount and never an unlimited allowance.

- Call `grantSession` to give a session key its bounds. Pass the session key address, the recipient allowlist, the per-payment limit, the spend cap, and the expiry as a Unix timestamp.

- Pass `{ fundGas: true }` to `grantSession` to send 0.01 tQDAY to the key right after the grant confirms so the key can pay its own gas. This is a plain native transfer, not a gasless flow.

- Read the return of `grantSession` as `{ grantHash, gasFundHash }`. The gas fund hash is only set when gas funding was requested.

- Call `canSpend` before a payment to mirror the contract checks. It checks paused state, active state, expiry, per-payment limit, cap, allowlist, and balance.

- Call `executePayment` to pay a recipient from the vault with the session key.

- Call `revokeSession` to kill a key instantly. Revocation is permanent.

- Call `editSession` to change a live key's bounds without resetting what it already spent. The cap can never drop below what the key has already spent.

- Call `pause` and `unpause` to halt and resume all payments from a vault.

- Call `ownerWithdraw` to sweep the full remaining balance. It works in any state, including paused.

- Call `getSession` to read a session's bounds and spent amount. Call `remainingCap` to read the spend cap minus spent.

- Call `vaultBalance` to read the vault's tUSD8 balance. Call `getPayments` and `getSessionGrants` to read history. Both chunk their log reads automatically because Aevum caps `eth_getLogs` at 1,000 blocks.

- Use `toBaseUnits` to convert a decimal string like "0.10" to base units. Use `fromBaseUnits` to convert back.

- Expect every write to use a legacy type 0 transaction. Expect every write to wait for its receipt and throw if the transaction reverts.

- Run `npm test` in `sdk/` for the unit tests. Run `npm run smoke-test` for a live end-to-end run on the testnet with a test wallet.

## Understand the session model

- Enforce four bounds on every session key, all on-chain. The recipient allowlist, the per-payment limit, the spend cap, and the expiry.

- Allow only the recipients on the allowlist. Any other recipient reverts.

- Treat the per-payment limit as the largest single payment. Treat the spend cap as the largest total the key may ever spend.

- Treat the expiry as a Unix timestamp. A payment is valid only while the current time is before it.

- Treat `spent` as a lifetime total. Re-granting a revoked or expired key starts fresh with zero spent.

- Read `remainingCap` as the spend cap minus spent even for a revoked or expired key. Check the session's active flag to verify revocation.

- Fund a session key with a little tQDAY for gas, because a key pays its own gas. Use the one-click gas funding on grant or fund it by hand.

- Revoke a key before granting it again, because a key that is already active cannot be granted again.

- Withdraw the full remaining balance after revoking, even without revoking, and even while paused. There is no separate delete step.

- Deploy a full independent vault per user through the factory. The factory holds no funds, no owner, no pause, and no upgrade path.

- Treat deposit as permissionless at the contract level and credited by balance delta. The app owner-gates deposits in the UI.

## Use the contract directly

- Read `SpendGuard.sol` and `SpendGuardFactory.sol` in the repo `src/` folder before you call the contract by hand.

- Call `createVault` on the factory to deploy a vault. The caller becomes the owner.

- Call `deposit` with an exact tUSD8 amount after approving the vault for that amount.

- Call `grantSession` with the session key, recipients, max per payment, spend cap, and expiry. The expiry in the struct is a uint64, but the SessionGranted event uses a uint256.

- Call `executePayment` with the session key, recipient, and amount. The checks run in order: caller must be the session key, session must be active, session must be unexpired, amount must be nonzero, amount must fit the per-payment limit, amount must fit the remaining cap, recipient must be allowlisted, and vault balance must cover it.

- Call `revokeSession` with the session key address to revoke it. Call `editSession` to change a live session's bounds.

- Call `pause` and `unpause` to control payments. Call `ownerWithdraw` to sweep the full balance.

- Read a session with `getSession`. Read the remaining cap with `remainingCap`. Read the balance with `vaultBalance`. Check a recipient with `isRecipientAllowed`.

- Avoid `cast call` for reads that return a tuple through a CLI signature. It cannot decode the getSession tuple. Use `remainingCap` and `vaultBalance` instead, or read through viem.

- Wrap every `cast` call in `timeout`. A bare `cast receipt` for a bad or missing hash hangs on this RPC.

- Read the transaction hash from `cast send --json` with `jq -r .transactionHash`. The output contains several hashes and the first one is not reliably the transaction hash.

- Verify a transaction hash against the explorer API or event logs before you report it.

- Never hand-type a private key. Derive it from the mnemonic or read it from the node startup log, then sanity-check it with `cast wallet address --private-key <key>` before funding or deploying.

- Run the Foundry tests with `forge test`. The suite covers the contracts with 56 tests.

## Use the web app

- Open `https://admuad.github.io/Spendguard/` for the live app. The Vercel deployment is `https://spendguard-ivory.vercel.app`.

- Connect an injected wallet only. There is no WalletConnect.

- Create a vault from the app. Vaults are known by address only. There is no name on creation.

- Grant a session from the Keys page. The grant form has a checkbox to also send 0.01 tQDAY for gas, checked by default.

- Pay from the Pay page with a session key. A revoked, expired, or paused session shows only the session card plus one reason line.

- Read the usage meter on the Overview page. The bar is the current vault balance only. The blue part is what live keys can still take. The grey row below the divider is what keys already paid out, shown as history, not as a bar segment.

- Expect the grant section to stay hidden unless the connected wallet owns the vault. The demo vault is view-only for everyone else.

- Expect the app to poll the chain every 20 seconds. It hydrates the demo vault from a seed file on first load, then fetches only the delta.

## Run the demo agent

- Change into the `agent/` folder and run `npm install`. Node 20 or newer is required. There is no build step.

- Grant a session to the agent key first, either in the web UI or with a contract call. The grant names the agent key address, the allowed recipients, the per-payment limit, the total spend cap, and the expiry.

- Fund the agent key with a little tQDAY for gas. The key holds no tUSD8. Payments come out of the vault, not out of the key.

- Run the scripted agent with exact values. Set `SESSION_KEY_PRIVATE_KEY`, `AGENT_RECIPIENT`, `AGENT_AMOUNT`, and `AGENT_INVOICE_ID`, then run `node agent.mjs --dry-run` first, then `node agent.mjs` to send.

- Run the LLM agent with a plain-language task. Set `SESSION_KEY_PRIVATE_KEY`, `AGENT_TASK`, `AGENT_PAYEES` as a JSON name-to-address directory, and `AGENT_INVOICE_ID`, then run `node llm-agent.mjs --dry-run` first, then `node llm-agent.mjs`.

- Expect the LLM agent to send the task, the payee directory, and the live session limits to the model. The model returns a structured decision with a recipient, an amount, and a reason, or it refuses on its own when the task exceeds the limits.

- Validate the model decision before any send. The recipient must be in the payee directory, the amount must parse exactly, and the SDK `canSpend` pre-flight must pass. The contract enforces the same bounds on-chain.

- Use Pollinations as the default model provider. It is free, needs no API key, and needs no account. Set `LLM_PROVIDER=openai` with `OPENAI_API_KEY` to use an OpenAI-compatible endpoint instead.

- Give every payment an invoice ID. Record paid invoice IDs in `agent-ledger.jsonl`. Refuse to pay an invoice ID already recorded as submitted or confirmed.

- Write every LLM run to `llm-agent-transcript.jsonl`. The transcript never contains a secret.

- Read exit code 0 as paid or dry-run passed. Read exit code 2 as refused and nothing sent. Read exit code 1 as an error or an unconfirmed transaction.

- Run `npm test` in the `agent/` folder for the agent test suite. It sends no transactions.

## Do and do not

- Use test keys only. Never use a mainnet key with SpendGuard. Never use the compromised main wallet 0x59788 for payouts or anything else.

- Never print a private key, a seed phrase, or a session key secret. Never write one to disk outside the process environment. Never commit one.

- Never hand-type a private key. Derive it from the mnemonic or read it from the node startup log.

- Never claim the agent can withdraw or deposit. A session key can only pay within its bounds.

- Never claim ERC-4337, ERC-8004, or x402 integration. SpendGuard does not use them.

- Never claim mainnet. SpendGuard runs on the Aevum testnet only, chain 44005.

- Both SpendGuard contracts ARE verified on the explorer (22 Nov 2026, forge verify-contract, Blockscout verifier, solc 0.8.24). Say so plainly, with the addresses and the exact commit in the README. Never claim a contract is verified that is not.

- Never install a `qday-*` npm package before Q1 2027.

- Never reuse the private key committed in Pista's `pause_tx.sh` files. Treat it as leaked.

- Run `--dry-run` first, every time, before a live agent run.

- Check the live session state against the chain before every send. Verify every transaction hash against the explorer before you report it.

- Keep vaults by address only. Do not add an on-chain name registry and do not save vault names in an external database.

- Use plain punctuation and no em dashes in UI copy, README text, and social copy.

## Verify live state

- Read the vault balance, the session, and the remaining cap from the chain before you state any number. Do not quote a balance from memory.

- Check the demo vault at `0x048a64225419C11C9Ff0CB39aA925902c5e965Ac` and the factory vault count when you need the current state.

- Confirm the live sites respond before you claim they are up. Check both the GitHub Pages URL and the Vercel URL.

- Confirm the SDK version on npm before you quote it. Run `npm view spendguard-sdk version`.

- Confirm the demo video URL before you quote it. The submission video is `https://youtu.be/ZwRmUPXpKJ8`.

## Files and links

- Read the SDK README at `sdk/README.md`. Read the agent README at `agent/README.md`. Read the agent security audit at `agent/AGENT-SECURITY.md`.

- Read the architecture, threat model, and submission readiness docs in the repo root as `ARCHITECTURE.md`, `THREAT-MODEL.md`, and `SUBMISSION-READINESS.md`.

- Find the live demo vault log seed at `ui/public/demo-vault-logs.json`.

- Find the demo agent source at `agent/agent.mjs`, `agent/llm-agent.mjs`, and `agent/llm-providers.mjs`.

- Find the SDK source at `sdk/src/client.ts`, `sdk/src/constants.ts`, and `sdk/src/index.ts`.

## Live proof

- Trust the 21 Nov 2026 live run. The LLM agent paid the freelancer 0.10 tUSD8 for the logo from the demo vault, tx `0x96da9c30a0fa510bb57a04f1054e044dd8430b1b8e7c5369a233cb65925b71a4`, confirmed block 3753239.

- Trust the refusal from the same day. The same agent refused a 5.00 tUSD8 request against a 0.50 per-payment limit on its own, before any pre-flight.
