# Ecosystem feedback: building SpendGuard on Aevum Testnet

What we hit while building SpendGuard (Nov 2026), written up for the QDay team. Everything here was verified live on the Aevum testnet (chain 44005), not guessed from the docs.

## What worked

- The testnet RPC (`rpc-test.qday.info`) was stable through the whole build, including fork tests and live deploys.
- The Blockscout explorer and its API v2 work well for reading logs, balances, and contract state.
- The tUSD8 faucet (Discord `#faucet` and faucet.qday.info) works; one claim per 24h is enough to build with.
- Discord `#dev-support` answers during their stated hours.

## What was wrong or missing

1. **The kit docs were wrong about tUSD8 transfers.** The docs said transfers do not revert on failure. Fork-verified on 18 Nov 2026: tUSD8 (`0x456569838f1d43009A91ebA4263147Afd7233483`, 6 decimals) DOES revert on transfer failure, moves exact amounts, has no fee, hooks, or blacklist, and its pause exists but is unpaused. We built our vault's accounting on the verified behavior, not the docs. The docs should be corrected, because a builder who trusts them writes the wrong code.
2. **No session-key tooling exists yet.** The official SDK is Q1 2027 and the "coming soon" items on qday.io/build (smart accounts, ERC-8004) have no addresses or endpoints. That gap is exactly why SpendGuard exists: scoped session keys in plain Solidity, no SDK needed. If those pieces are out of scope for this challenge, say so plainly; if they are in scope, publish addresses and a working example.
3. **The rubric does not match across pages.** qday.io/builder-challenge links Starter Kit V2 with 7 criteria and 100 points. DoraHacks lists an 8th criterion, Ecosystem contribution, and links a different kit. Builders cannot tell which version and weights the judges will use, or how ecosystem contribution is counted. One rubric, in one place, would fix this.
4. **Small gaps worth documenting.** EIP-3009 is absent from tUSD8 while EIP-2612 (permit) is present. `eth_getLogs` caps at 1,000 blocks per call. There is no WebSocket RPC. None of these blocked us, but all of them cost build time to discover.

## Suggestions

- Publish the verified behavior of tUSD8 (reverts, exact amounts, no fees/hooks/blacklist, pause state, permit support) as a short reference page.
- For every "coming soon" item, either publish an address and a minimal working example or mark it out of scope for the current challenge.
- Align the judging rubric between DoraHacks and the starter guide, and say how ecosystem contribution is scored.
- Keep the faucet and the support channel as they are; both work.
