import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { aevumTestnet, RPC_URL } from "./config";

/**
 * Wallet config: injected browser wallets only (MetaMask, Rabby, …).
 * WalletConnect is deliberately NOT included: it needs a WalletConnect
 * project id, which is a secret that has no place in a zero-env-var app.
 * Any injected wallet works without one.
 */
export const wagmiConfig = createConfig({
  chains: [aevumTestnet],
  connectors: [injected()],
  transports: {
    [aevumTestnet.id]: http(RPC_URL),
  },
  ssr: true,
});
