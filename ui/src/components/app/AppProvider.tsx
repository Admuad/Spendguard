"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import {
  DEPLOY_BLOCK,
  FACTORY_ADDRESS,
  FACTORY_DEPLOY_BLOCK,
  VAULT_ADDRESS,
  aevumTestnet,
  factoryAbi,
} from "@/lib/config";
import { isValidAddress } from "@/lib/format";
import type { SessionState, VaultData } from "@/lib/useVaultData";
import { useMyVaults, useVaultData, useWalletTokenData } from "@/lib/useVaultData";
import { useWriteFlow } from "@/components/VaultApp";
import type { TxPhase } from "@/components/VaultApp";

const SELECTED_VAULT_KEY = "spendguard-selected-vault";

type AppState = {
  address: Address | undefined;
  isConnected: boolean;
  chainId: number | undefined;
  wrongChain: boolean;
  now: number;
  selected: Address;
  isDemo: boolean;
  myVaults: readonly Address[];
  selectVault: (vault: Address) => void;
  vault: VaultData;
  tokenBalance: bigint | null;
  allowance: bigint | null;
  refreshTokenData: () => void;
  isOwner: boolean;
  mySession: SessionState | null;
  createVault: () => void;
  createBusy: boolean;
  createPhase: TxPhase;
  createHash: `0x${string}` | undefined;
  createError: string | null;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (ctx === null) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

/**
 * One source of truth for the whole app section: connected wallet, selected
 * vault, live vault data and the wallet's token balance. It lives in the
 * /app layout, so moving between Overview, Keys, Pay, Activity and Settings
 * never re-fetches or flashes empty.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const [now, setNow] = useState(() => Date.now());
  const { vaults: myVaults, refresh: refreshMyVaults } = useMyVaults(address);
  const [selected, setSelected] = useState<Address>(VAULT_ADDRESS);
  const [picked, setPicked] = useState(false);

  // Restore the stored choice after mount (a static export cannot read
  // localStorage during the server render).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SELECTED_VAULT_KEY);
      if (stored !== null && isValidAddress(stored)) setSelected(stored as Address);
    } catch {
      // Private mode: fall back to the demo vault.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // First visit with a connected wallet that owns vaults: open the first own
  // vault, unless a stored choice or an explicit pick says otherwise.
  useEffect(() => {
    if (picked || !isConnected || myVaults.length === 0) return;
    try {
      if (window.localStorage.getItem(SELECTED_VAULT_KEY) !== null) return;
    } catch {
      // ignore
    }
    setSelected(myVaults[0]);
  }, [picked, isConnected, myVaults]);

  const selectVault = useCallback((vaultAddr: Address) => {
    setPicked(true);
    setSelected(vaultAddr);
    try {
      window.localStorage.setItem(SELECTED_VAULT_KEY, vaultAddr);
    } catch {
      // Private mode: the choice lasts for this session only.
    }
  }, []);

  const isDemo = selected.toLowerCase() === VAULT_ADDRESS.toLowerCase();
  const vault = useVaultData(selected, isDemo ? DEPLOY_BLOCK : FACTORY_DEPLOY_BLOCK);
  const { tokenBalance, allowance, refreshTokenData } = useWalletTokenData(address, selected);

  const createFlow = useWriteFlow(async () => {
    const list = await refreshMyVaults();
    if (list.length > 0) selectVault(list[list.length - 1]);
  });
  const createBusy = createFlow.phase === "signing" || createFlow.phase === "confirming";
  const createVault = useCallback(() => {
    createFlow.submit({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "createVault",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFlow.submit]);

  const wrongChain = isConnected && chainId !== aevumTestnet.id;
  const isOwner =
    isConnected && !!address && !!vault.owner && address.toLowerCase() === vault.owner.toLowerCase();
  const mySession =
    address != null
      ? (vault.sessions.find((s) => s.key.toLowerCase() === address.toLowerCase()) ?? null)
      : null;

  const value: AppState = {
    address,
    isConnected,
    chainId,
    wrongChain,
    now,
    selected,
    isDemo,
    myVaults,
    selectVault,
    vault,
    tokenBalance,
    allowance,
    refreshTokenData,
    isOwner,
    mySession,
    createVault,
    createBusy,
    createPhase: createFlow.phase,
    createHash: createFlow.hash,
    createError: createFlow.errorMessage,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
