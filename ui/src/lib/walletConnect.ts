import { useCallback, useEffect, useRef, useState } from "react";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * Connect to an injected wallet, tolerating a wallet that is not injected
 * yet. Some wallets only inject `window.ethereum` once the user opens and
 * unlocks the extension, so a plain `connect()` at page load can do
 * nothing: the user had to unlock, refresh the page, and tap Connect
 * again. This hook fixes that without WalletConnect (which would need a
 * project id, a secret this zero-env-var app deliberately does not have):
 *
 * - If a provider is present, connect immediately, as before.
 * - If not, wait: poll for the provider and listen for the EIP-1193
 *   `ethereum#initialized` event, then connect automatically the moment
 *   the wallet appears. No refresh needed.
 * - After 60s with no provider, surface the same friendly "no wallet
 *   found" error the plain path shows, so the user can try again.
 */
const WAIT_MS = 60000;
const POLL_MS = 500;

function hasProvider(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { ethereum?: unknown }).ethereum !==
      "undefined"
  );
}

export function useWalletConnect() {
  const { connect, isPending, error: connectError, reset } = useConnect();
  const [waiting, setWaiting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  });

  // While waiting, watch for the wallet appearing (unlock injects it) and
  // connect automatically. Effects clean up on unmount and when the wait
  // ends, so no timer can outlive the component.
  useEffect(() => {
    if (!waiting) return;
    const tryConnect = () => {
      if (hasProvider()) {
        setWaiting(false);
        connectRef.current({ connector: injected() });
      }
    };
    const id = window.setInterval(tryConnect, POLL_MS);
    const timeout = window.setTimeout(() => {
      setWaiting(false);
      setNotFound(true);
    }, WAIT_MS);
    window.addEventListener("ethereum#initialized", tryConnect);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timeout);
      window.removeEventListener("ethereum#initialized", tryConnect);
    };
  }, [waiting]);

  const connectWallet = useCallback(() => {
    reset();
    setNotFound(false);
    if (hasProvider()) {
      connect({ connector: injected() });
      return;
    }
    setWaiting(true);
  }, [connect, reset]);

  const resetAll = useCallback(() => {
    setWaiting(false);
    setNotFound(false);
    reset();
  }, [reset]);

  // The synthetic error reuses the friendly "no wallet found" message in
  // plainConnectErrorMessage (it matches "ProviderNotFound").
  const error = notFound
    ? new Error("ProviderNotFound: no injected wallet appeared")
    : connectError;

  return {
    connectWallet,
    /** True while connecting or while waiting for the wallet to appear. */
    isPending: isPending || waiting,
    waiting,
    error,
    resetAll,
  };
}
