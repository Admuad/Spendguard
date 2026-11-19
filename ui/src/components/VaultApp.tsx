"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAccount, useConnect, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Address } from "viem";
import { ArrowUpRight, KeyRound, ShieldCheck } from "lucide-react";
import {
  DEPLOY_BLOCK,
  FACTORY_ADDRESS,
  FACTORY_DEPLOY_BLOCK,
  FAUCET_URL,
  TUSD8_ADDRESS,
  VAULT_ADDRESS,
  aevumTestnet,
  erc20Abi,
  explorerAddressUrl,
  explorerTxUrl,
  factoryAbi,
  spendGuardAbi,
} from "@/lib/config";
import {
  formatExpiry,
  formatTusd8,
  formatTusd8Input,
  isValidAddress,
  parseRecipients,
  parseTusd8,
  plainConnectErrorMessage,
  plainErrorMessage,
  plainSwitchErrorMessage,
  shortenAddress,
} from "@/lib/format";
import type { SessionState, VaultData } from "@/lib/useVaultData";
import { useMyVaults, useVaultData, useWalletTokenData } from "@/lib/useVaultData";
import { getKeyLabel, useKeyLabels } from "@/lib/keyLabels";
import { UsageMeter } from "@/components/app/UsageMeter";

/** Legacy transactions: the starter-kit docs warn some tooling mishandles
 * EIP-1559 fields on this chain, and the vault itself was deployed legacy. */
const TX_TYPE = "legacy" as const;

// ---------------------------------------------------------------------------
// Shared write flow: signing -> confirming -> success / plain-language error.
// ---------------------------------------------------------------------------
export type TxPhase = "idle" | "signing" | "confirming" | "success" | "error";

export function useWriteFlow(onConfirmed?: () => void) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  // wagmi's isSuccess only means the receipt arrived, and wagmi's wrapper
  // THROWS (a bare Error carrying the replayed revert reason) when a
  // receipt is reverted, so a reverted transaction surfaces as a receipt
  // query error, never as a reverted receipt. Both shapes are handled:
  // a reverted receipt if one ever arrives, and the bare-Error throw.
  // A viem/RPC error (named, e.g. TransactionReceiptNotFoundError) is a
  // read failure instead, and says so.
  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: receiptLoaded,
    isError: receiptError,
    error: receiptQueryError,
  } = useWaitForTransactionReceipt({ hash });
  const isReverted = receiptLoaded && receipt?.status === "reverted";
  const isSuccess = receiptLoaded && receipt?.status === "success";
  const isRevertThrow =
    receiptError && receiptQueryError instanceof Error && receiptQueryError.name === "Error";
  const confirmedHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (isSuccess && hash && confirmedHashRef.current !== hash) {
      confirmedHashRef.current = hash;
      onConfirmed?.();
    }
  }, [isSuccess, hash, onConfirmed]);

  const phase: TxPhase =
    error || isReverted || receiptError
      ? "error"
      : isSuccess
        ? "success"
        : hash && isConfirming
          ? "confirming"
          : isPending
            ? "signing"
            : "idle";

  // A replayed reason is shown only when it reads as plain text; custom
  // errors replay to empty or binary data, which would be mojibake.
  const revertReason = receiptQueryError instanceof Error ? receiptQueryError.message.trim() : "";
  const readableReason =
    revertReason !== "" &&
    revertReason !== "unknown reason" &&
    /^[\x20-\x7E]{3,120}$/.test(revertReason)
      ? revertReason
      : null;

  const errorMessage = error
    ? plainErrorMessage(error)
    : isReverted || isRevertThrow
      ? readableReason
        ? `The contract rejected this transaction on-chain: ${readableReason}. Nothing changed. The caps or vault state may have moved since the check.`
        : "The contract rejected this transaction on-chain, so nothing changed. The caps or vault state may have moved since the check. See the transaction for the exact revert."
      : receiptError
        ? "The transaction was sent, but its confirmation could not be read. Check the explorer link before trying again, so the same action is not sent twice."
        : null;

  const submit = (args: Parameters<typeof writeContract>[0]) => {
    reset();
    writeContract({ ...args, type: TX_TYPE } as Parameters<typeof writeContract>[0]);
  };

  return { hash, phase, errorMessage, submit, reset };
}

export function TxStatus({
  phase,
  hash,
  errorMessage,
  successLabel,
}: {
  phase: TxPhase;
  hash: `0x${string}` | undefined;
  errorMessage: string | null;
  successLabel: string;
}) {
  if (phase === "idle") return null;
  if (phase === "signing") {
    return <div className="tx-status tx-status-pending">Waiting for wallet approval… Check your wallet to sign.</div>;
  }
  if (phase === "confirming") {
    return (
      <div className="tx-status tx-status-pending">
        Transaction submitted. Waiting for confirmation on Aevum testnet.{" "}
        {hash && (
          <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
            View on the explorer ↗
          </a>
        )}
      </div>
    );
  }
  if (phase === "success") {
    return (
      <div className="tx-status tx-status-success" role="status">
        {successLabel}{" "}
        {hash && (
          <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
            View on the explorer ↗
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="tx-status tx-status-error" role="alert">
      {errorMessage ?? "The transaction failed."}{" "}
      {hash && (
        <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
          View on the explorer ↗
        </a>
      )}
    </div>
  );
}

export function ConnectPrompt({ action }: { action: string }) {
  const { connect, isPending, error, reset } = useConnect();
  return (
    <div className="empty-state connect-prompt">
      <p style={{ margin: "0 0 14px" }}>
        Connect a browser wallet (MetaMask, Rabby, or any injected wallet) to {action}.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={isPending}
        onClick={() => {
          reset();
          connect({ connector: injected() });
        }}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {plainConnectErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deposit: exact-amount approve, then deposit. No unlimited approvals.
// ---------------------------------------------------------------------------
export function DepositPanel({
  vault,
  vaultAddress,
  isOwner,
  tokenBalance,
  allowance,
  refreshTokenData,
}: {
  vault: VaultData;
  vaultAddress: Address;
  isOwner: boolean;
  tokenBalance: bigint | null;
  allowance: bigint | null;
  refreshTokenData: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("1");
  const approveFlow = useWriteFlow(refreshTokenData);
  const depositFlow = useWriteFlow(() => {
    vault.refresh();
    refreshTokenData();
  });

  const parsed = useMemo(() => parseTusd8(amount), [amount]);
  const needsApproval =
    parsed !== null && parsed > 0n && (allowance === null || allowance < parsed);
  const insufficientBalance =
    parsed !== null && tokenBalance !== null && parsed > tokenBalance;

  const busy =
    approveFlow.phase === "signing" ||
    approveFlow.phase === "confirming" ||
    depositFlow.phase === "signing" ||
    depositFlow.phase === "confirming";

  if (!isConnected || !address) {
    return (
      <div className="panel">
        <h3>Deposit tUSD8</h3>
        <p className="panel-desc">
          Only the vault owner can deposit from this page. Connect the owner
          wallet to fund this vault.
        </p>
        <ConnectPrompt action="deposit" />
      </div>
    );
  }

  if (!isOwner) {
    const viewingDemo = vaultAddress.toLowerCase() === VAULT_ADDRESS.toLowerCase();
    return (
      <div className="panel">
        <h3>Deposit tUSD8</h3>
        <p className="panel-desc">
          Depositing is owner-only. The connected wallet is not the vault
          owner, so the deposit form is disabled for this account.
        </p>
        <div className="empty-state">
          Only the vault owner can deposit into this vault.{" "}
          {viewingDemo ? (
            <>
              This is the demo vault, owned by the project. Create your own
              vault from the bar above to fund a vault you own.
            </>
          ) : (
            <>
              The vault owner is{" "}
              {vault.owner ? (
                <a href={explorerAddressUrl(vault.owner)} target="_blank" rel="noreferrer">
                  {shortenAddress(vault.owner)}
                </a>
              ) : (
                "loading…"
              )}
              .
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Deposit tUSD8</h3>
      <p className="panel-desc">
        Two steps, both exact-amount: approve exactly what you deposit, then
        deposit. No unlimited approvals, ever. You can top up as often as
        you like; every deposit adds to the same vault balance.
      </p>
      <div className="field">
        <label htmlFor="deposit-amount">Amount to deposit</label>
        <div className="amount-wrap">
          <input
            id="deposit-amount"
            className="input"
            inputMode="decimal"
            placeholder="1.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <span className="amount-suffix">tUSD8</span>
        </div>
        <div className="amount-chips" aria-label="Quick amounts">
          <span className="amount-chips-label">Quick amount</span>
          {(
            [
              ["20%", 20n],
              ["50%", 50n],
              ["Max", 100n],
            ] as const
          ).map(([chipLabel, pct]) => {
            const value = tokenBalance === null ? null : (tokenBalance * pct) / 100n;
            return (
              <button
                key={chipLabel}
                type="button"
                className="amount-chip"
                disabled={busy || value === null || value === 0n}
                onClick={() => value !== null && setAmount(formatTusd8Input(value))}
              >
                {chipLabel}
              </button>
            );
          })}
        </div>
        <p className="field-hint">
          Your wallet holds{" "}
          {tokenBalance === null ? "…" : `${formatTusd8(tokenBalance)} tUSD8`}. Need test
          tokens?{" "}
          <a href={FAUCET_URL} target="_blank" rel="noreferrer">
            Aevum faucet ↗
          </a>
        </p>
        {parsed === null && amount.trim() !== "" && (
          <p className="error-text">Enter a valid amount, up to 6 decimal places.</p>
        )}
        {parsed !== null && parsed === 0n && (
          <p className="error-text">The amount must be greater than zero.</p>
        )}
        {insufficientBalance && (
          <p className="error-text">
            That is more tUSD8 than your wallet holds. Lower the amount or top up
            from the faucet.
          </p>
        )}
      </div>

      {needsApproval ? (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy || parsed === null || parsed === 0n || insufficientBalance}
          onClick={() =>
            parsed &&
            approveFlow.submit({
              address: TUSD8_ADDRESS,
              abi: erc20Abi,
              functionName: "approve",
              args: [vaultAddress, parsed],
            })
          }
        >
          {approveFlow.phase === "signing" || approveFlow.phase === "confirming"
            ? "Approving…"
            : `Step 1 of 2: approve exactly ${parsed ? formatTusd8(parsed) : "…"} tUSD8`}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy || parsed === null || parsed === 0n || insufficientBalance}
          onClick={() =>
            parsed &&
            depositFlow.submit({
              address: vaultAddress,
              abi: spendGuardAbi,
              functionName: "deposit",
              args: [parsed],
            })
          }
        >
          {depositFlow.phase === "signing" || depositFlow.phase === "confirming"
            ? "Depositing…"
            : `Step 2 of 2: deposit ${parsed ? formatTusd8(parsed) : "…"} tUSD8`}
        </button>
      )}

      {needsApproval && (
        <p className="field-hint" style={{ marginTop: 10 }}>
          Current allowance: {allowance === null ? "…" : `${formatTusd8(allowance)} tUSD8`}.
          After approval, the deposit button appears.
        </p>
      )}
      <TxStatus
        phase={approveFlow.phase}
        hash={approveFlow.hash}
        errorMessage={approveFlow.errorMessage}
        successLabel="Approved. Now confirm the deposit."
      />
      <TxStatus
        phase={depositFlow.phase}
        hash={depositFlow.hash}
        errorMessage={depositFlow.errorMessage}
        successLabel="Deposited. The vault balance updates live."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grant: owner-only form with a confirmation summary before signing.
// ---------------------------------------------------------------------------
const EXPIRY_PRESETS = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 6 * 3600 },
  { label: "24 hours", seconds: 24 * 3600 },
  { label: "7 days", seconds: 7 * 24 * 3600 },
  { label: "30 days", seconds: 30 * 24 * 3600 },
] as const;

export function GrantPanel({ vault, vaultAddress, isOwner }: { vault: VaultData; vaultAddress: Address; isOwner: boolean }) {
  const { isConnected } = useAccount();
  const [sessionKey, setSessionKey] = useState("");
  const [recipients, setRecipients] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("0.50");
  const [spendCap, setSpendCap] = useState("2.00");
  const [expiryPreset, setExpiryPreset] = useState<number>(24 * 3600);
  const [customExpiry, setCustomExpiry] = useState("");
  const [useCustomExpiry, setUseCustomExpiry] = useState(false);
  const [keyName, setKeyName] = useState("");
  const { saveLabel } = useKeyLabels();

  const grantFlow = useWriteFlow(() => {
    vault.refresh();
    setSessionKey("");
    setRecipients("");
    setKeyName("");
  });

  const parsedMax = useMemo(() => parseTusd8(maxPerTx), [maxPerTx]);
  const parsedCap = useMemo(() => parseTusd8(spendCap), [spendCap]);
  const parsedRecipients = useMemo(() => parseRecipients(recipients), [recipients]);

  const expiresAt = useMemo(() => {
    if (useCustomExpiry) {
      const ms = Date.parse(customExpiry);
      return Number.isNaN(ms) ? null : BigInt(Math.floor(ms / 1000));
    }
    return BigInt(Math.floor(Date.now() / 1000) + expiryPreset);
  }, [useCustomExpiry, customExpiry, expiryPreset]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const problems: string[] = [];
  if (sessionKey.trim() !== "" && !isValidAddress(sessionKey)) {
    problems.push("The session-key address is not a valid address.");
  }
  if (parsedRecipients.invalid.length > 0) {
    problems.push(
      `These recipient entries are not valid addresses: ${parsedRecipients.invalid.slice(0, 3).join(", ")}${parsedRecipients.invalid.length > 3 ? "…" : ""}`,
    );
  }
  if (parsedMax !== null && parsedMax === 0n) problems.push("The per-transaction limit must be greater than zero.");
  if (parsedCap !== null && parsedCap === 0n) problems.push("The spend cap must be greater than zero.");
  if (parsedMax !== null && parsedCap !== null && parsedMax > parsedCap) {
    problems.push("The per-transaction limit cannot be larger than the total spend cap.");
  }
  if (expiresAt !== null && expiresAt <= now) problems.push("The expiry must be in the future.");

  const formValid =
    isValidAddress(sessionKey) &&
    parsedRecipients.valid.length > 0 &&
    parsedRecipients.invalid.length === 0 &&
    parsedMax !== null &&
    parsedMax > 0n &&
    parsedCap !== null &&
    parsedCap > 0n &&
    parsedMax <= parsedCap &&
    expiresAt !== null &&
    expiresAt > now;

  const busy = grantFlow.phase === "signing" || grantFlow.phase === "confirming";

  if (!isConnected) {
    return (
      <div className="panel">
        <h3>Grant a session key</h3>
        <p className="panel-desc">
          The owner grants a key its bounds: who it may pay, how much per
          payment, how much in total, and until when.
        </p>
        <ConnectPrompt action="grant a session" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="panel">
        <h3>Grant a session key</h3>
        <p className="panel-desc">
          Only the vault owner can grant sessions. You are connected as a
          non-owner wallet, so granting is disabled for this account.
        </p>
        <div className="empty-state">
          Vault owner:{" "}
          {vault.owner ? (
            <a href={explorerAddressUrl(vault.owner)} target="_blank" rel="noreferrer">
              {vault.owner}
            </a>
          ) : (
            "loading…"
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Grant a session key</h3>
      <p className="panel-desc">
        Give a person, bot, or agent a bounded key. It can only pay the
        recipients below, within the caps, before the expiry. You can
        revoke it instantly at any time.
      </p>

      <div className="field">
        <label htmlFor="grant-key">Session-key address</label>
        <input
          id="grant-key"
          className="input input-mono"
          placeholder="0x…"
          value={sessionKey}
          onChange={(e) => setSessionKey(e.target.value)}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="field-hint">
          The wallet or agent address that will hold this key. It never needs
          the owner key.
        </p>
      </div>

      <div className="field">
        <label htmlFor="grant-name">Key name (optional)</label>
        <input
          id="grant-name"
          className="input"
          placeholder="e.g. Trading bot"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          disabled={busy}
          autoComplete="off"
          maxLength={60}
        />
        <p className="field-hint">
          What is this key for? The name shows in the sessions list so you
          can tell keys apart. It is stored only in this browser.
        </p>
      </div>

      <div className="field">
        <label htmlFor="grant-recipients">Allowed recipients (one per line)</label>
        <textarea
          id="grant-recipients"
          className="textarea input-mono"
          placeholder={"0x…\n0x…"}
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="field-hint">
          Payments from this key can only go to these addresses. Any other
          recipient reverts on-chain.
        </p>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="grant-maxtx">Max per payment</label>
          <div className="amount-wrap">
            <input
              id="grant-maxtx"
              className="input"
              inputMode="decimal"
              value={maxPerTx}
              onChange={(e) => setMaxPerTx(e.target.value)}
              disabled={busy}
            />
            <span className="amount-suffix">tUSD8</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="grant-cap">Total spend cap</label>
          <div className="amount-wrap">
            <input
              id="grant-cap"
              className="input"
              inputMode="decimal"
              value={spendCap}
              onChange={(e) => setSpendCap(e.target.value)}
              disabled={busy}
            />
            <span className="amount-suffix">tUSD8</span>
          </div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="grant-expiry">Expires after</label>
        <select
          id="grant-expiry"
          className="select"
          value={useCustomExpiry ? "custom" : String(expiryPreset)}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "custom") setUseCustomExpiry(true);
            else {
              setUseCustomExpiry(false);
              setExpiryPreset(Number(e.target.value));
            }
          }}
        >
          {EXPIRY_PRESETS.map((preset) => (
            <option key={preset.label} value={preset.seconds}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom date and time…</option>
        </select>
        {useCustomExpiry && (
          <input
            type="datetime-local"
            className="input"
            style={{ marginTop: 10 }}
            value={customExpiry}
            onChange={(e) => setCustomExpiry(e.target.value)}
            disabled={busy}
            aria-label="Custom expiry date and time"
          />
        )}
      </div>

      {formValid && expiresAt !== null && (
        <div className="confirm-box" aria-label="Grant summary">
          <h4>Review before signing</h4>
          <div className="confirm-row">
            <span>Session key</span>
            <span>{shortenAddress(sessionKey.trim())}</span>
          </div>
          {keyName.trim() !== "" && (
            <div className="confirm-row">
              <span>Name</span>
              <span>{keyName.trim()}</span>
            </div>
          )}
          <div className="confirm-row">
            <span>Recipients</span>
            <span>{parsedRecipients.valid.length} approved</span>
          </div>
          <div className="confirm-row">
            <span>Max per payment</span>
            <span>{parsedMax !== null ? `${formatTusd8(parsedMax)} tUSD8` : "…"}</span>
          </div>
          <div className="confirm-row">
            <span>Total spend cap</span>
            <span>{parsedCap !== null ? `${formatTusd8(parsedCap)} tUSD8` : "…"}</span>
          </div>
          <div className="confirm-row">
            <span>Expires</span>
            <span>{formatExpiry(expiresAt)}</span>
          </div>
          <div className="confirm-row">
            <span>Maximum loss if this key is stolen</span>
            <span>{parsedCap !== null ? `${formatTusd8(parsedCap)} tUSD8` : "…"}</span>
          </div>
        </div>
      )}

      {problems.map((problem) => (
        <p key={problem} className="error-text">
          {problem}
        </p>
      ))}

      <div className="warn-box" aria-label="Risks to know before granting">
        <h4>Know the risks before you grant</h4>
        <ul>
          <li>
            If the key holder loses the key, the grant cannot be used. The
            funds stay in the vault. Revoke the session and grant a fresh one.
          </li>
          <li>
            Check the key address twice. A grant to the wrong address gives
            spending power to whoever controls that address. The only fix is
            to revoke and re-grant.
          </li>
          <li>
            Bounds can be edited later from the sessions list, but the cap
            can never drop below what the key has already spent. Only a
            fresh grant after a revoke starts with zero spent.
          </li>
        </ul>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!formValid || busy}
        onClick={() => {
          if (!formValid || expiresAt === null || parsedMax === null || parsedCap === null) return;
          if (keyName.trim() !== "") saveLabel(vaultAddress, sessionKey.trim(), keyName.trim());
          grantFlow.submit({
            address: vaultAddress,
            abi: spendGuardAbi,
            functionName: "grantSession",
            args: [
              sessionKey.trim() as Address,
              parsedRecipients.valid as Address[],
              parsedMax,
              parsedCap,
              Number(expiresAt),
            ],
          });
        }}
      >
        {busy ? "Granting…" : "Grant session"}
      </button>
      <TxStatus
        phase={grantFlow.phase}
        hash={grantFlow.hash}
        errorMessage={grantFlow.errorMessage}
        successLabel="Session granted. The key can spend within its bounds now."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revoke confirmation: a custom pop-up, never a toast. Revoking an active
// key is the one destructive owner action, so the consequences are spelled
// out and the safe choice is the focused default.
// ---------------------------------------------------------------------------
function RevokeConfirmModal({
  session,
  vaultAddress,
  now,
  busy,
  onCancel,
  onConfirm,
}: {
  session: SessionState;
  vaultAddress: Address;
  now: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onCancel]);

  const expired = Number(session.expiresAt) * 1000 <= now;
  const { labels } = useKeyLabels();
  const label = getKeyLabel(labels, vaultAddress, session.key);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Revoke session key confirmation"
      onClick={onCancel}
    >
      <div className="modal modal-narrow" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
          ×
        </button>
        <h3>Revoke this session key?</h3>
        <p>
          This key is still active. Revoking takes effect the moment the
          transaction is mined.
        </p>
        <div className="confirm-box">
          <div className="confirm-row">
            <span>Key</span>
            <span>{shortenAddress(session.key)}</span>
          </div>
          {label !== null && (
            <div className="confirm-row">
              <span>Name</span>
              <span>{label}</span>
            </div>
          )}
          <div className="confirm-row">
            <span>Spent</span>
            <span>
              {formatTusd8(session.spent)} of {formatTusd8(session.spendCap)} tUSD8
            </span>
          </div>
          <div className="confirm-row">
            <span>Remaining cap</span>
            <span>{formatTusd8(session.remainingCap)} tUSD8</span>
          </div>
          <div className="confirm-row">
            <span>Status</span>
            <span>{expired ? "Expired" : "Active"}</span>
          </div>
        </div>
        <ul className="modal-warnings">
          <li>The key stops spending immediately. Any agent using it is cut off.</li>
          <li>The remaining cap is gone. The funds stay in the vault, untouched.</li>
          <li>
            You can grant this address a fresh session later. A fresh grant
            starts with zero spent.
          </li>
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel} autoFocus>
            Keep this key
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>
            {busy ? "Revoking…" : "Revoke key"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit bounds: a pop-up form that re-specifies a live session's bounds.
// `spent` is never touched: the contract preserves it, and the new cap must
// cover it. Revoked sessions cannot be edited (no button appears for them);
// expired-but-active sessions can, which is how an expiry is extended.
// On success the pop-up stays open showing the confirmed transaction, so
// the owner sees the change land; on error the form stays intact to retry.
// ---------------------------------------------------------------------------
function EditSessionModal({
  session,
  vaultAddress,
  now,
  onClose,
  onEdited,
}: {
  session: SessionState;
  vaultAddress: Address;
  now: number;
  onClose: () => void;
  onEdited: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const { labels } = useKeyLabels();
  const label = getKeyLabel(labels, vaultAddress, session.key);
  const expired = Number(session.expiresAt) * 1000 <= now;

  const [maxPerTx, setMaxPerTx] = useState(() => formatTusd8Input(session.maxPerTx));
  const [spendCap, setSpendCap] = useState(() => formatTusd8Input(session.spendCap));
  const [recipients, setRecipients] = useState(() => session.recipients.join("\n"));
  const [expiryMode, setExpiryMode] = useState(expired ? "86400" : "keep");

  const editFlow = useWriteFlow(onEdited);
  const busy = editFlow.phase === "signing" || editFlow.phase === "confirming";

  const parsedMax = parseTusd8(maxPerTx);
  const parsedCap = parseTusd8(spendCap);
  const parsedRecipients = parseRecipients(recipients);
  const expiresAt =
    expiryMode === "keep"
      ? session.expiresAt
      : BigInt(Math.floor(now / 1000) + Number(expiryMode));

  const problems: string[] = [];
  if (parsedMax === null || parsedMax === 0n) problems.push("Enter a per-payment limit above zero.");
  if (parsedCap === null || parsedCap === 0n) problems.push("Enter a total spend cap above zero.");
  if (parsedMax !== null && parsedCap !== null && parsedMax > parsedCap) {
    problems.push("The per-payment limit cannot be larger than the total spend cap.");
  }
  if (parsedCap !== null && parsedCap < session.spent) {
    problems.push(
      `The cap cannot go below the ${formatTusd8(session.spent)} tUSD8 this key has already spent. Raise the cap, or revoke the key instead.`,
    );
  }
  if (parsedRecipients.invalid.length > 0) problems.push("One or more recipient addresses are invalid.");
  if (parsedRecipients.valid.length === 0) problems.push("Add at least one allowed recipient.");
  if (expiresAt <= BigInt(Math.floor(now / 1000))) problems.push("Pick an expiry in the future.");

  const unchanged =
    parsedMax === session.maxPerTx &&
    parsedCap === session.spendCap &&
    expiresAt === session.expiresAt &&
    parsedRecipients.valid.length === session.recipients.length &&
    parsedRecipients.valid.every((r, i) => r.toLowerCase() === session.recipients[i].toLowerCase());
  const formValid = problems.length === 0 && !unchanged;

  const boundRow = (oldValue: bigint, newValue: bigint | null) =>
    newValue === null || newValue === oldValue
      ? `${formatTusd8(oldValue)} tUSD8`
      : `${formatTusd8(oldValue)} → ${formatTusd8(newValue)} tUSD8`;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Edit session bounds"
      onClick={onClose}
    >
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h3>Edit session bounds</h3>
        <p>
          Key {shortenAddress(session.key)}
          {label !== null ? ` (${label})` : ""}. The bounds below replace the
          current ones the moment the transaction is mined. What the key has
          already spent stays spent.
        </p>
        {editFlow.phase === "success" ? (
          <>
            <TxStatus
              phase={editFlow.phase}
              hash={editFlow.hash}
              errorMessage={editFlow.errorMessage}
              successLabel="Bounds updated. The key spends under the new bounds now."
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="edit-max">Max per payment (tUSD8)</label>
              <input
                id="edit-max"
                className="input"
                inputMode="decimal"
                value={maxPerTx}
                onChange={(e) => setMaxPerTx(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="edit-cap">Total spend cap (tUSD8)</label>
              <input
                id="edit-cap"
                className="input"
                inputMode="decimal"
                value={spendCap}
                onChange={(e) => setSpendCap(e.target.value)}
                disabled={busy}
              />
              <p className="field-hint">
                Already spent: {formatTusd8(session.spent)} tUSD8. The cap
                cannot go below that.
              </p>
            </div>
            <div className="field">
              <label htmlFor="edit-expiry">Expiry</label>
              <select
                id="edit-expiry"
                className="select"
                value={expiryMode}
                onChange={(e) => setExpiryMode(e.target.value)}
                disabled={busy}
              >
                <option value="keep" disabled={expired}>
                  Keep current expiry ({formatExpiry(session.expiresAt)})
                </option>
                <option value="3600">1 hour from now</option>
                <option value="86400">24 hours from now</option>
                <option value="604800">7 days from now</option>
                <option value="2592000">30 days from now</option>
              </select>
              {expired && (
                <p className="field-hint">
                  This session has expired. Pick a new expiry to extend it.
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="edit-recipients">Allowed recipients (one per line)</label>
              <textarea
                id="edit-recipients"
                className="input textarea"
                rows={3}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                disabled={busy}
                spellCheck={false}
              />
            </div>
            <div className="confirm-box" aria-label="New bounds">
              <div className="confirm-row">
                <span>Max per payment</span>
                <span>{boundRow(session.maxPerTx, parsedMax)}</span>
              </div>
              <div className="confirm-row">
                <span>Total spend cap</span>
                <span>{boundRow(session.spendCap, parsedCap)}</span>
              </div>
              <div className="confirm-row">
                <span>Expiry</span>
                <span>
                  {expiresAt === session.expiresAt
                    ? formatExpiry(session.expiresAt)
                    : `${formatExpiry(session.expiresAt)} → ${formatExpiry(expiresAt)}`}
                </span>
              </div>
              <div className="confirm-row">
                <span>Recipients</span>
                <span>
                  {parsedRecipients.valid.length === session.recipients.length &&
                  parsedRecipients.valid.every((r, i) => r.toLowerCase() === session.recipients[i].toLowerCase())
                    ? `${session.recipients.length} approved`
                    : `${session.recipients.length} → ${parsedRecipients.valid.length} approved`}
                </span>
              </div>
            </div>
            {problems.map((problem) => (
              <p key={problem} className="error-text" role="alert">
                {problem}
              </p>
            ))}
            <TxStatus
              phase={editFlow.phase}
              hash={editFlow.hash}
              errorMessage={editFlow.errorMessage}
              successLabel="Bounds updated."
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!formValid || busy}
                onClick={() => {
                  if (!formValid || parsedMax === null || parsedCap === null) return;
                  editFlow.submit({
                    address: vaultAddress,
                    abi: spendGuardAbi,
                    functionName: "editSession",
                    args: [
                      session.key,
                      parsedRecipients.valid as Address[],
                      parsedMax,
                      parsedCap,
                      Number(expiresAt),
                    ],
                  });
                }}
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions: every key ever granted, with live state, one-click revoke, and
// editable bounds.
// ---------------------------------------------------------------------------
export function SessionsPanel({ vault, vaultAddress, isOwner, now }: { vault: VaultData; vaultAddress: Address; isOwner: boolean; now: number }) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const { labels, saveLabel } = useKeyLabels();
  const sortedSessions = useMemo(
    () =>
      [...vault.sessions].sort((a, b) => {
        if (a.spent !== b.spent) return a.spent < b.spent ? 1 : -1;
        if (a.active !== b.active) return a.active ? -1 : 1;
        return 0;
      }),
    [vault.sessions],
  );
  const totalSpent = useMemo(
    () => vault.sessions.reduce((sum, s) => sum + s.spent, 0n),
    [vault.sessions],
  );
  const revokeFlow = useWriteFlow(() => {
    vault.refresh();
    setRevoking(null);
  });
  // A failed revoke closes the pop-up so the plain-language error in the
  // panel is visible instead of sitting behind the modal.
  useEffect(() => {
    if (revokeFlow.phase === "error") setRevoking(null);
  }, [revokeFlow.phase]);
  const revokingSession =
    revoking === null
      ? null
      : (vault.sessions.find((s) => s.key.toLowerCase() === revoking) ?? null);
  const editingSession =
    editing === null
      ? null
      : (vault.sessions.find((s) => s.key.toLowerCase() === editing) ?? null);

  return (
    <div className="panel panel-wide">
      <h3>Sessions</h3>
      <p className="panel-desc">
        Every session key ever granted to this vault, with its live
        on-chain state. Revoking is immediate and irreversible. A revoked
        key can never spend again. Bounds can be edited while a session is
        active; an edit never resets what the key has spent.
      </p>

      {vault.loading && vault.sessions.length === 0 ? (
        <p className="muted">Loading sessions…</p>
      ) : vault.sessions.length === 0 ? (
        <div className="empty-state">
          No sessions have been granted yet. The owner can grant the first
          one above: a key, its recipients, its caps, and its expiry.
        </div>
      ) : (
        <>
          <p className="sessions-summary">
            {formatTusd8(totalSpent)} tUSD8 spent in total across {vault.sessions.length}{" "}
            {vault.sessions.length === 1 ? "key" : "keys"}, most spending first.
          </p>
          {sortedSessions.map((session) => (
            <SessionRow
              key={session.key}
              session={session}
              label={getKeyLabel(labels, vaultAddress, session.key)}
              totalSpent={totalSpent}
              onSaveLabel={(name) => saveLabel(vaultAddress, session.key, name)}
              isOwner={isOwner}
              now={now}
              vaultBalance={vault.balance}
              onAskRevoke={() => setRevoking(session.key.toLowerCase())}
              onAskEdit={() => setEditing(session.key.toLowerCase())}
            />
          ))}
          <p className="field-hint">Key names are stored only in this browser.</p>
        </>
      )}

      <TxStatus
        phase={revokeFlow.phase}
        hash={revokeFlow.hash}
        errorMessage={revokeFlow.errorMessage}
        successLabel="Session revoked. The key can never spend again."
      />
      {revokingSession !== null && (
        <RevokeConfirmModal
          session={revokingSession}
          vaultAddress={vaultAddress}
          now={now}
          busy={revokeFlow.phase === "signing" || revokeFlow.phase === "confirming"}
          onCancel={() => setRevoking(null)}
          onConfirm={() =>
            revokeFlow.submit({
              address: vaultAddress,
              abi: spendGuardAbi,
              functionName: "revokeSession",
              args: [revokingSession.key],
            })
          }
        />
      )}
      {editingSession !== null && (
        <EditSessionModal
          session={editingSession}
          vaultAddress={vaultAddress}
          now={now}
          onClose={() => setEditing(null)}
          onEdited={() => vault.refresh()}
        />
      )}
    </div>
  );
}

function SessionRow({
  session,
  label,
  totalSpent,
  onSaveLabel,
  isOwner,
  now,
  vaultBalance,
  onAskRevoke,
  onAskEdit,
}: {
  session: SessionState;
  label: string | null;
  totalSpent: bigint;
  vaultBalance: bigint | null;
  onSaveLabel: (name: string) => void;
  isOwner: boolean;
  now: number;
  onAskRevoke: () => void;
  onAskEdit: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const expired = Number(session.expiresAt) * 1000 <= now;
  const status = !session.active ? "Revoked" : expired ? "Expired" : "Active";

  return (
    <div className="session-row">
      <div className="session-top">
        <div className="session-identity">
          {label !== null && <span className="session-label">{label}</span>}
          <a
            className="session-key"
            href={explorerAddressUrl(session.key)}
            target="_blank"
            rel="noreferrer"
          >
            <span className="session-key-full">{session.key}</span>
            <span className="session-key-short">{shortenAddress(session.key)}</span>
          </a>
        </div>
        {status !== "Active" && <span className="badge">{status}</span>}
      </div>
      <UsageMeter session={session} vaultBalance={vaultBalance} now={now} totalSpent={totalSpent} />
      <div className="recipient-chips" aria-label="Allowed recipients">
        {session.recipients.map((recipient) => (
          <a
            key={recipient}
            className="recipient-chip"
            href={explorerAddressUrl(recipient)}
            target="_blank"
            rel="noreferrer"
          >
            {shortenAddress(recipient)}
          </a>
        ))}
      </div>
      {editingName ? (
        <div className="name-editor">
          <input
            className="input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="e.g. Trading bot"
            maxLength={60}
            autoFocus
            aria-label="Key name"
          />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              onSaveLabel(draftName);
              setEditingName(false);
            }}
          >
            Save name
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setEditingName(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="name-link"
          onClick={() => {
            setDraftName(label ?? "");
            setEditingName(true);
          }}
        >
          {label === null ? "Name this key" : "Rename"}
        </button>
      )}
      {isOwner && session.active && (
        <div className="session-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={onAskEdit}>
            Edit bounds
          </button>
          <button type="button" className="btn btn-outline btn-sm btn-danger-outline" onClick={onAskRevoke}>
            Revoke session
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent view: the connected wallet pays as its own session key.
// ---------------------------------------------------------------------------
export function AgentPanel({
  vault,
  vaultAddress,
  mySession,
  now,
}: {
  vault: VaultData;
  vaultAddress: Address;
  mySession: SessionState | null;
  now: number;
}) {
  const { address, isConnected } = useAccount();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.10");
  const payFlow = useWriteFlow(() => vault.refresh());

  const parsed = useMemo(() => parseTusd8(amount), [amount]);
  const expired = mySession ? Number(mySession.expiresAt) * 1000 <= now : false;

  const problems: string[] = [];
  if (mySession) {
    if (!mySession.active) problems.push("Your session is revoked. Ask the owner for a fresh grant.");
    else if (expired) problems.push("Your session has expired. Ask the owner for a fresh grant.");
    if (vault.paused) problems.push("The vault is paused. Payments are frozen until the owner unpauses.");
    if (parsed !== null && parsed > 0n) {
      if (parsed > mySession.maxPerTx) {
        problems.push(
          `That is above your per-payment limit of ${formatTusd8(mySession.maxPerTx)} tUSD8.`,
        );
      }
      if (parsed > mySession.remainingCap) {
        problems.push(
          `That is above your remaining cap of ${formatTusd8(mySession.remainingCap)} tUSD8.`,
        );
      }
      if (vault.balance !== null && parsed > vault.balance) {
        problems.push(
          `This payment of ${formatTusd8(parsed)} tUSD8 exceeds the vault balance of ${formatTusd8(vault.balance)} tUSD8. The owner needs to deposit ${formatTusd8(parsed - vault.balance)} tUSD8 more before this payment can go through.`,
        );
      }
    }
    if (recipient !== "" && !mySession.recipients.some((r) => r.toLowerCase() === recipient.toLowerCase())) {
      problems.push("That recipient is not on your session's allowlist.");
    }
  }

  const canPay =
    mySession !== null &&
    mySession.active &&
    !expired &&
    !vault.paused &&
    parsed !== null &&
    parsed > 0n &&
    recipient !== "" &&
    problems.length === 0;

  const busy = payFlow.phase === "signing" || payFlow.phase === "confirming";

  if (!isConnected || !address) {
    return (
      <div className="panel">
        <h3>Pay as a session key</h3>
        <p className="panel-desc">
          A granted key pays merchants within its bounds. Only the key
          itself can call. No one can spend another key&apos;s session.
        </p>
        <ConnectPrompt action="pay as a session key" />
      </div>
    );
  }

  if (!mySession) {
    return (
      <div className="panel">
        <h3>Pay as a session key</h3>
        <p className="panel-desc">
          A granted key pays merchants within its bounds. Only the key
          itself can call. No one can spend another key&apos;s session.
        </p>
        <div className="empty-state">
          No session has been granted to {shortenAddress(address)} yet. Ask the
          vault owner to grant one, with the recipients and caps your work
          needs.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Pay as a session key</h3>
      <p className="panel-desc">
        You are paying as <strong>{shortenAddress(address)}</strong>. The
        contract checks the caller, the caps, the allowlist, and the expiry on
        every payment.
      </p>

      <div className="confirm-box">
        <h4>Your session</h4>
        <div className="confirm-row">
          <span>Status</span>
          <span>{!mySession.active ? "Revoked" : expired ? "Expired" : "Active"}</span>
        </div>
        <div className="confirm-row">
          <span>Spent</span>
          <span>
            {formatTusd8(mySession.spent)} of {formatTusd8(mySession.spendCap)} tUSD8
          </span>
        </div>
        <div className="confirm-row">
          <span>Remaining cap</span>
          <span>{formatTusd8(mySession.remainingCap)} tUSD8</span>
        </div>
        <div className="confirm-row">
          <span>Max per payment</span>
          <span>{formatTusd8(mySession.maxPerTx)} tUSD8</span>
        </div>
        <div className="confirm-row">
          <span>Expires</span>
          <span>{formatExpiry(mySession.expiresAt)}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="pay-recipient">Recipient (from your allowlist)</label>
        <select
          id="pay-recipient"
          className="select"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={busy}
        >
          <option value="">Choose a recipient…</option>
          {mySession.recipients.map((r) => (
            <option key={r} value={r}>
              {shortenAddress(r)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="pay-amount">Amount</label>
        <div className="amount-wrap">
          <input
            id="pay-amount"
            className="input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <span className="amount-suffix">tUSD8</span>
        </div>
      </div>

      {problems.map((problem) => (
        <p key={problem} className="error-text">
          {problem}
        </p>
      ))}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!canPay || busy}
        onClick={() => {
          if (!canPay || parsed === null) return;
          payFlow.submit({
            address: vaultAddress,
            abi: spendGuardAbi,
            functionName: "executePayment",
            args: [address, recipient as Address, parsed],
          });
        }}
      >
        {busy ? "Paying…" : `Pay ${parsed ? formatTusd8(parsed) : "…"} tUSD8`}
      </button>
      <TxStatus
        phase={payFlow.phase}
        hash={payFlow.hash}
        errorMessage={payFlow.errorMessage}
        successLabel="Payment executed. The audit trail updates live."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owner controls: pause / unpause / sweep. Pause never blocks the sweep.
// ---------------------------------------------------------------------------
export function OwnerPanel({ vault, vaultAddress, isOwner }: { vault: VaultData; vaultAddress: Address; isOwner: boolean }) {
  const { isConnected } = useAccount();
  const [confirmingSweep, setConfirmingSweep] = useState(false);
  const [lastPauseAction, setLastPauseAction] = useState<"pause" | "unpause" | null>(null);
  const pauseFlow = useWriteFlow(() => vault.refresh());
  const sweepFlow = useWriteFlow(() => {
    vault.refresh();
    setConfirmingSweep(false);
  });

  const busy =
    pauseFlow.phase === "signing" ||
    pauseFlow.phase === "confirming" ||
    sweepFlow.phase === "signing" ||
    sweepFlow.phase === "confirming";

  if (!isConnected) {
    return (
      <div className="panel">
        <h3>Owner controls</h3>
        <p className="panel-desc">
          Pause freezes payments instantly; the sweep always works, paused or
          not. Recovery is never locked behind a pause.
        </p>
        <ConnectPrompt action="use owner controls" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="panel">
        <h3>Owner controls</h3>
        <p className="panel-desc">
          Pause, unpause, and sweep are owner-only. The connected wallet is not
          the vault owner.
        </p>
        <div className="empty-state">
          Only the vault owner can pause payments or sweep the balance.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Owner controls</h3>
      <p className="panel-desc">
        Circuit breaker and recovery. Pausing freezes every payment instantly;
        the sweep recovers the full remaining balance in any state.
      </p>

      <div className="confirm-box">
        <div className="confirm-row">
          <span>Vault status</span>
          <span>{vault.paused === null ? "…" : vault.paused ? "Paused" : "Unpaused"}</span>
        </div>
        <div className="confirm-row">
          <span>Vault balance</span>
          <span>{vault.balance === null ? "…" : `${formatTusd8(vault.balance)} tUSD8`}</span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {vault.paused ? (
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() => {
              setLastPauseAction("unpause");
              pauseFlow.submit({
                address: vaultAddress,
                abi: spendGuardAbi,
                functionName: "unpause",
              });
            }}
          >
            {pauseFlow.phase === "signing" || pauseFlow.phase === "confirming"
              ? "Unpausing…"
              : "Unpause payments"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-outline btn-block"
            disabled={busy}
            onClick={() => {
              setLastPauseAction("pause");
              pauseFlow.submit({
                address: vaultAddress,
                abi: spendGuardAbi,
                functionName: "pause",
              });
            }}
          >
            {pauseFlow.phase === "signing" || pauseFlow.phase === "confirming"
              ? "Pausing…"
              : "Pause all payments"}
          </button>
        )}

        {confirmingSweep ? (
          <div className="inline-confirm" style={{ marginTop: 0 }}>
            <span>
              Sweep the full balance (
              {vault.balance === null ? "…" : `${formatTusd8(vault.balance)} tUSD8`}) to the
              owner wallet?
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() =>
                sweepFlow.submit({
                  address: vaultAddress,
                  abi: spendGuardAbi,
                  functionName: "ownerWithdraw",
                })
              }
            >
              {sweepFlow.phase === "signing" || sweepFlow.phase === "confirming"
                ? "Sweeping…"
                : "Yes, sweep"}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setConfirmingSweep(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-outline btn-block"
            disabled={busy || vault.balance === 0n}
            onClick={() => setConfirmingSweep(true)}
          >
            Sweep vault balance to owner
          </button>
        )}
      </div>

      <TxStatus
        phase={pauseFlow.phase}
        hash={pauseFlow.hash}
        errorMessage={pauseFlow.errorMessage}
        successLabel={lastPauseAction === "unpause" ? "Vault unpaused." : "Vault paused. Payments are frozen; the sweep still works."}
      />
      <TxStatus
        phase={sweepFlow.phase}
        hash={sweepFlow.hash}
        errorMessage={sweepFlow.errorMessage}
        successLabel="Sweep complete. The vault balance is now zero."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile-only chrome: one shared connect prompt, a segmented panel switch,
// and a persistent bottom action bar. Desktop renders none of this (CSS),
// and every control below drives the same single wagmi connection and the
// same panel components as the desktop grid.
// ---------------------------------------------------------------------------
type MobilePanel = "deposit" | "grant" | "pay" | "owner" | "sessions";

const MOBILE_PANELS: Array<{ id: MobilePanel; label: string }> = [
  { id: "deposit", label: "Deposit" },
  { id: "grant", label: "Grant" },
  { id: "pay", label: "Pay" },
  { id: "owner", label: "Owner" },
  { id: "sessions", label: "Sessions" },
];

/** One connect prompt for the whole vault section on mobile, replacing the
 * per-panel prompts (hidden by CSS below 860px). */
function MobileConnectPrompt() {
  const { connect, isPending, error, reset } = useConnect();
  return (
    <div className="mobile-shared-prompt">
      <p>
        Connect a browser wallet to use the vault. One connection unlocks
        every panel, and the vault data above stays readable without one.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={isPending}
        onClick={() => {
          reset();
          connect({ connector: injected() });
        }}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {plainConnectErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

function MobileActionBar({
  active,
  onNavigate,
}: {
  active: MobilePanel;
  onNavigate: (panel: MobilePanel) => void;
}) {
  const { isConnected, chainId } = useAccount();
  const { connect, isPending, error: connectError, reset: resetConnect } = useConnect();
  const {
    switchChain,
    isPending: isSwitching,
    error: switchError,
    reset: resetSwitch,
  } = useSwitchChain();
  const wrongChain = isConnected && chainId !== aevumTestnet.id;

  if (!isConnected) {
    return (
      <div className="mobile-action-bar">
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={isPending}
          onClick={() => {
            resetConnect();
            connect({ connector: injected() });
          }}
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {connectError && (
          <p className="error-text" role="alert">
            {plainConnectErrorMessage(connectError)}
          </p>
        )}
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="mobile-action-bar">
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={isSwitching}
          onClick={() => {
            resetSwitch();
            switchChain({ chainId: aevumTestnet.id });
          }}
        >
          {isSwitching ? "Switching…" : "Switch to Aevum"}
        </button>
        {switchError && (
          <p className="error-text" role="alert">
            {plainSwitchErrorMessage(switchError)}
          </p>
        )}
      </div>
    );
  }

  const tabs: Array<{ id: MobilePanel; label: string; icon: ReactNode }> = [
    {
      id: "deposit",
      label: "Vault",
      icon: <ShieldCheck size={20} aria-hidden="true" />,
    },
    {
      id: "grant",
      label: "Grant",
      icon: <KeyRound size={20} aria-hidden="true" />,
    },
    {
      id: "pay",
      label: "Pay",
      icon: <ArrowUpRight size={20} aria-hidden="true" />,
    },
  ];

  return (
    <nav className="mobile-action-bar mobile-action-bar-tabs" aria-label="Vault shortcuts">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="mobile-action-tab"
          aria-pressed={active === tab.id}
          onClick={() => onNavigate(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// The vault app section: network banner + all panels.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Vault selection: the demo vault plus the connected wallet's own vaults.
// The demo vault is always badged and explained; a connected user lands on
// their own vault (or a create-your-vault prompt) instead of the demo.
// ---------------------------------------------------------------------------

const SELECTED_VAULT_KEY = "spendguard-selected-vault";

function VaultBar({
  selected,
  isDemo,
  myVaults,
  isConnected,
  vaultOwner,
  onSelect,
  onCreate,
  createBusy,
  createPhase,
  createHash,
  createError,
}: {
  selected: Address;
  isDemo: boolean;
  myVaults: readonly Address[];
  isConnected: boolean;
  vaultOwner: Address | null;
  onSelect: (vault: Address) => void;
  onCreate: () => void;
  createBusy: boolean;
  createPhase: TxPhase;
  createHash: `0x${string}` | undefined;
  createError: string | null;
}) {
  // A stored selection from another wallet is still a real vault: show it
  // as a pill so the bar never shows nothing selected.
  const extraVault =
    !isDemo && !myVaults.some((v) => v.toLowerCase() === selected.toLowerCase())
      ? selected
      : null;

  return (
    <div className="vault-bar">
      <div className="vault-bar-row">
        <span className="vault-bar-label">Viewing</span>
        <div className="vault-pills" role="group" aria-label="Choose a vault">
          <button
            type="button"
            className={`vault-pill${isDemo ? " active" : ""}`}
            aria-pressed={isDemo}
            onClick={() => onSelect(VAULT_ADDRESS)}
          >
            Demo vault
          </button>
          {myVaults.map((vaultAddr, i) => (
            <button
              type="button"
              key={vaultAddr}
              className={`vault-pill${selected.toLowerCase() === vaultAddr.toLowerCase() ? " active" : ""}`}
              aria-pressed={selected.toLowerCase() === vaultAddr.toLowerCase()}
              onClick={() => onSelect(vaultAddr)}
            >
              {myVaults.length > 1 ? `Your vault ${i + 1} · ` : "Your vault · "}
              {shortenAddress(vaultAddr)}
            </button>
          ))}
          {extraVault !== null && (
            <button type="button" className="vault-pill active" aria-pressed="true">
              Vault · {shortenAddress(extraVault)}
            </button>
          )}
        </div>
        {isConnected && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={createBusy}
            onClick={onCreate}
          >
            {createBusy ? "Creating…" : "+ Create vault"}
          </button>
        )}
      </div>
      <div className="vault-context">
        {isDemo && <span className="demo-badge">Demo</span>}
        <div className="vault-context-body">
          <p className="vault-context-text">
            {isDemo
              ? "This is the project's demo vault. Its funds belong to the demo, not to you. Create your own vault to manage your own funds, or explore this one read-only."
              : "Your vault. You own it: only you can deposit, grant keys, pause, and withdraw. The demo vault stays separate."}
          </p>
          <p className="vault-context-meta">
            <span className="vault-context-addr">
              Vault{" "}
              <a href={explorerAddressUrl(selected)} target="_blank" rel="noreferrer">
                {shortenAddress(selected)}
              </a>
            </span>
            {isDemo && vaultOwner !== null && (
              <span className="vault-context-addr">
                {" "}· Owner{" "}
                <a href={explorerAddressUrl(vaultOwner)} target="_blank" rel="noreferrer">
                  {shortenAddress(vaultOwner)}
                </a>
              </span>
            )}
          </p>
        </div>
      </div>
      {!isConnected && (
        <div className="vault-context">
          <div className="vault-context-body">
            <p className="vault-context-text">
              Connect a wallet to create your own vault. Until then you are
              viewing the demo vault.
            </p>
          </div>
        </div>
      )}
      <TxStatus
        phase={createPhase}
        hash={createHash}
        errorMessage={createError}
        successLabel="Vault created. You are now viewing your new vault."
      />
    </div>
  );
}

export function VaultApp() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const [now, setNow] = useState(() => Date.now());
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("deposit");
  const { vaults: myVaults, refresh: refreshMyVaults } = useMyVaults(address);
  const [selected, setSelected] = useState<Address>(() => {
    if (typeof window === "undefined") return VAULT_ADDRESS;
    const stored = window.localStorage.getItem(SELECTED_VAULT_KEY);
    return stored !== null && isValidAddress(stored) ? (stored as Address) : VAULT_ADDRESS;
  });
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // First visit with a connected wallet that owns vaults: open the first own
  // vault, unless a stored choice or an explicit pick says otherwise.
  useEffect(() => {
    if (picked || !isConnected || myVaults.length === 0) return;
    if (window.localStorage.getItem(SELECTED_VAULT_KEY) !== null) return;
    setSelected(myVaults[0]);
  }, [picked, isConnected, myVaults]);

  const selectVault = useCallback((vaultAddr: Address) => {
    setPicked(true);
    setSelected(vaultAddr);
    window.localStorage.setItem(SELECTED_VAULT_KEY, vaultAddr);
  }, []);

  const isDemo = selected.toLowerCase() === VAULT_ADDRESS.toLowerCase();
  const vault = useVaultData(selected, isDemo ? DEPLOY_BLOCK : FACTORY_DEPLOY_BLOCK);
  const { tokenBalance, allowance, refreshTokenData } = useWalletTokenData(address, selected);

  const createFlow = useWriteFlow(async () => {
    const list = await refreshMyVaults();
    if (list.length > 0) selectVault(list[list.length - 1]);
  });
  const createBusy =
    createFlow.phase === "signing" || createFlow.phase === "confirming";

  const wrongChain = isConnected && chainId !== aevumTestnet.id;
  const isOwner =
    isConnected && !!address && !!vault.owner && address.toLowerCase() === vault.owner.toLowerCase();
  const mySession =
    address != null
      ? (vault.sessions.find((s) => s.key.toLowerCase() === address.toLowerCase()) ?? null)
      : null;

  return (
    <section className="section app-section" id="app">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Live vaults</span>
          <h2 className="section-title">Use the vault</h2>
          <p className="section-sub">
            Start with the demo vault, or connect a wallet and create your own
            vault. Reads are live without a wallet; writes need a connected
            wallet on chain 44005, and every revert is explained in plain
            language.
          </p>
        </div>

        {wrongChain && (
          <div className="net-banner" role="alert">
            <div>
              <strong>Wrong network.</strong> Your wallet is connected to chain{" "}
              {chainId}, but the vault lives on the Aevum testnet (chain 44005).
              Switch networks to use the vault.
              {switchError && (
                <div className="error-text">{plainSwitchErrorMessage(switchError)}</div>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={isSwitching}
              onClick={() => {
                resetSwitch();
                switchChain({ chainId: aevumTestnet.id });
              }}
            >
              {isSwitching ? "Switching…" : "Switch to Aevum Testnet"}
            </button>
          </div>
        )}

        <VaultBar
          selected={selected}
          isDemo={isDemo}
          myVaults={myVaults}
          isConnected={isConnected}
          vaultOwner={vault.owner}
          onSelect={selectVault}
          onCreate={() =>
            createFlow.submit({
              address: FACTORY_ADDRESS,
              abi: factoryAbi,
              functionName: "createVault",
            })
          }
          createBusy={createBusy}
          createPhase={createFlow.phase}
          createHash={createFlow.hash}
          createError={createFlow.errorMessage}
        />

        {!isConnected && <MobileConnectPrompt />}

        <div className="vault-segments" role="group" aria-label="Vault panels">
          {MOBILE_PANELS.map((panel) => (
            <button
              key={panel.id}
              type="button"
              className="vault-segment"
              aria-pressed={mobilePanel === panel.id}
              onClick={() => setMobilePanel(panel.id)}
            >
              {panel.label}
            </button>
          ))}
        </div>

        {/* Panels sit in two independent columns, so each column packs
            tightly with no voids and a panel growing in one column never
            moves the other. The mobile single-panel view keys off
            data-panel on each slot, not DOM order. */}
        <div className="app-panels" data-mobile-panel={mobilePanel}>
          <div className="app-columns">
            <div className="app-col">
              <div className="panel-slot" data-panel="deposit">
                <DepositPanel
                  vault={vault}
                  vaultAddress={selected}
                  isOwner={isOwner}
                  tokenBalance={tokenBalance}
                  allowance={allowance}
                  refreshTokenData={refreshTokenData}
                />
              </div>
              <div className="panel-slot" data-panel="pay">
                <AgentPanel vault={vault} vaultAddress={selected} mySession={mySession} now={now} />
              </div>
              <div className="panel-slot" data-panel="owner">
                <OwnerPanel vault={vault} vaultAddress={selected} isOwner={isOwner} />
              </div>
            </div>
            <div className="app-col">
              <div className="panel-slot" data-panel="grant">
                <GrantPanel vault={vault} vaultAddress={selected} isOwner={isOwner} />
              </div>
            </div>
          </div>
          <div className="panel-slot" data-panel="sessions">
            <SessionsPanel vault={vault} vaultAddress={selected} isOwner={isOwner} now={now} />
          </div>
        </div>
      </div>
      <MobileActionBar
        active={mobilePanel}
        onNavigate={(panel) => {
          setMobilePanel(panel);
          document.querySelector("#app")?.scrollIntoView({ behavior: "smooth" });
        }}
      />
    </section>
  );
}
