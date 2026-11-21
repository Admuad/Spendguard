#!/usr/bin/env node
/**
 * Fetch the demo vault's full event history and write it as a static seed
 * (ui/public/demo-vault-logs.json) in the same VaultLogCache shape the app
 * already stores in localStorage.
 *
 * Why: a cold first visit scans ~255k blocks in 1,000-block eth_getLogs
 * chunks (~255 calls). On a phone that is minutes of "Loading activity...".
 * The demo vault's history is small (tens of logs) and changes rarely, so
 * shipping it with the app makes the first load instant: the app hydrates
 * from the seed and only fetches blocks after the seed's tip.
 *
 * Run by `npm run prebuild` (see package.json) so every deploy ships a
 * fresh seed. It is safe to run by hand too. If the RPC is unreachable it
 * exits non-zero and leaves any existing seed file untouched, so the build
 * must never depend on this script succeeding.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, "..");
const SEED_PATH = join(UI_DIR, "public", "demo-vault-logs.json");

const RPC_URL = "https://rpc-test.qday.info";
const VAULT_ADDRESS = "0x048a64225419C11C9Ff0CB39aA925902c5e965Ac";
const DEPLOY_BLOCK = 3492987n;
const MAX_LOG_RANGE = 1000n;
const CONCURRENCY = 6;

const aevumTestnet = defineChain({
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

const client = createPublicClient({
  chain: aevumTestnet,
  transport: http(RPC_URL),
});

async function main() {
  const latest = await client.getBlockNumber();
  console.log(`demo vault seed: scanning ${DEPLOY_BLOCK}..${latest}`);

  const ranges = [];
  let cursor = DEPLOY_BLOCK;
  while (cursor <= latest) {
    const end = cursor + MAX_LOG_RANGE - 1n > latest ? latest : cursor + MAX_LOG_RANGE - 1n;
    ranges.push({ from: cursor, to: end });
    cursor = end + 1n;
  }
  console.log(`demo vault seed: ${ranges.length} chunks`);

  const results = new Array(ranges.length);
  let next = 0;
  async function worker() {
    while (next < ranges.length) {
      const i = next++;
      const r = ranges[i];
      results[i] = await client.getLogs({
        address: VAULT_ADDRESS,
        fromBlock: r.from,
        toBlock: r.to,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, () => worker()));

  const logs = results.flat();
  console.log(`demo vault seed: ${logs.length} logs`);

  const seed = {
    version: 1,
    vault: VAULT_ADDRESS.toLowerCase(),
    scannedThrough: latest.toString(),
    logs: logs.map((l) => ({
      b: `0x${(l.blockNumber ?? 0n).toString(16)}`,
      h: l.transactionHash,
      i: l.logIndex ?? 0,
      t: [...l.topics],
      d: l.data,
    })),
  };
  writeFileSync(SEED_PATH, JSON.stringify(seed));
  console.log(`demo vault seed: wrote ${SEED_PATH} (${logs.length} logs, tip ${latest})`);
}

main().catch((err) => {
  console.error(`demo vault seed: failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
