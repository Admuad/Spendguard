import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { aevumTestnet, RPC_URL } from "./config";

/**
 * Wallet config: injected browser wallets only (MetaMask, Rabby, …).
 * WalletConnect is deliberately NOT included: it needs a WalletConnect
 * project id, which is a secret that has no place in a zero-env-var app.
 * Any injected wallet works without one.
 *
 * Persistence: this app is a static client-side build (no server), so the
 * config intentionally does NOT use wagmi's `ssr` mode. With `ssr: true`,
 * wagmi skips store hydration and only restores the connection from a
 * server-provided cookie `initialState` — which a static build can never
 * provide. The result is the classic hackathon flaw: close the tab, reopen
 * it, and the app shows disconnected even though the wallet still has the
 * site connected, forcing the user to disconnect in the wallet and
 * reconnect. With the default (non-SSR) config, wagmi persists the
 * connection in localStorage and reconnects automatically on load, with no
 * wallet prompt, via `eth_accounts`. An explicit disconnect is remembered
 * too (the injected connector's disconnect shim), so disconnecting stays
 * disconnected across reloads.
 */
export const wagmiConfig = createConfig({
  chains: [aevumTestnet],
  connectors: [injected()],
  transports: {
    [aevumTestnet.id]: http(RPC_URL),
  },
});
