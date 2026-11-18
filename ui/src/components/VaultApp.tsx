"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Address } from "viem";
import {
  FAUCET_URL,
  TUSD8_ADDRESS,
  VAULT_ADDRESS,
  aevumTestnet,
  erc20Abi,
  explorerAddressUrl,
  explorerTxUrl,
  spendGuardAbi,
} from "@/lib/config";
import {
  formatExpiry,
  formatTusd8,
  isValidAddress,
  parseRecipients,
  parseTusd8,
  plainConnectErrorMessage,
  plainErrorMessage,
  plainSwitchErrorMessage,
  shortenAddress,
} from "@/lib/format";
import type { SessionState, VaultData } from "@/lib/useVaultData";
import { useWalletTokenData } from "@/lib/useVaultData";

/** Legacy transactions: the starter-kit docs warn some tooling mishandles
 * EIP-1559 fields on this chain, and the vault itself was deployed legacy. */
const TX_TYPE = "legacy" as const;

// ---------------------------------------------------------------------------
// Shared write flow: signing -> confirming -> success / plain-language error.
// ---------------------------------------------------------------------------
type TxPhase = "idle" | "signing" | "confirming" | "success" | "error";

function useWriteFlow(onConfirmed?: () => void) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  // wagmi's isSuccess only means the receipt arrived — and wagmi's wrapper
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
        ? `The contract rejected this transaction on-chain: ${readableReason}. Nothing changed — the caps or vault state may have moved since the check.`
        : "The contract rejected this transaction on-chain, so nothing changed. The caps or vault state may have moved since the check — see the transaction for the exact revert."
      : receiptError
        ? "The transaction was sent, but its confirmation could not be read. Check the explorer link before trying again, so the same action is not sent twice."
        : null;

  const submit = (args: Parameters<typeof writeContract>[0]) => {
    reset();
    writeContract({ ...args, type: TX_TYPE } as Parameters<typeof writeContract>[0]);
  };

  return { hash, phase, errorMessage, submit, reset };
}

function TxStatus({
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
        Transaction submitted — waiting for confirmation on Aevum testnet.{" "}
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

function ConnectPrompt({ action }: { action: string }) {
  const { connect, isPending, error, reset } = useConnect();
  return (
    <div className="empty-state">
      <p style={{ margin: "0 0 14px" }}>
        Connect a browser wallet (MetaMask, Rabby, or any injected wallet) to {action}. The vault
        data above is live and readable without a wallet.
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
function DepositPanel({
  vault,
  tokenBalance,
  allowance,
  refreshTokenData,
}: {
  vault: VaultData;
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
          Fund the vault. Anyone can deposit; depositing can only increase the
          balance, never decrease it.
        </p>
        <ConnectPrompt action="deposit" />
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Deposit tUSD8</h3>
      <p className="panel-desc">
        Two steps, both exact-amount: approve exactly what you deposit, then
        deposit. No unlimited approvals, ever.
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
              args: [VAULT_ADDRESS, parsed],
            })
          }
        >
          {approveFlow.phase === "signing" || approveFlow.phase === "confirming"
            ? "Approving…"
            : `Step 1 of 2 — Approve exactly ${parsed ? formatTusd8(parsed) : "…"} tUSD8`}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy || parsed === null || parsed === 0n || insufficientBalance}
          onClick={() =>
            parsed &&
            depositFlow.submit({
              address: VAULT_ADDRESS,
              abi: spendGuardAbi,
              functionName: "deposit",
              args: [parsed],
            })
          }
        >
          {depositFlow.phase === "signing" || depositFlow.phase === "confirming"
            ? "Depositing…"
            : `Step 2 of 2 — Deposit ${parsed ? formatTusd8(parsed) : "…"} tUSD8`}
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

function GrantPanel({ vault, isOwner }: { vault: VaultData; isOwner: boolean }) {
  const { isConnected } = useAccount();
  const [sessionKey, setSessionKey] = useState("");
  const [recipients, setRecipients] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("0.50");
  const [spendCap, setSpendCap] = useState("2.00");
  const [expiryPreset, setExpiryPreset] = useState<number>(24 * 3600);
  const [customExpiry, setCustomExpiry] = useState("");
  const [useCustomExpiry, setUseCustomExpiry] = useState(false);

  const grantFlow = useWriteFlow(() => {
    vault.refresh();
    setSessionKey("");
    setRecipients("");
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
        recipients below, within the caps, before the expiry — and you can
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
          <div className="confirm-row">
            <span>Recipients</span>
            <span>{parsedRecipients.valid.length} approved</span>
          </div>
          <div className="confirm-row">
            <span>Max per payment</span>
            <span>{parsedMax !== null ? `${formatTusd8(parsedMax)} tUSD8` : "—"}</span>
          </div>
          <div className="confirm-row">
            <span>Total spend cap</span>
            <span>{parsedCap !== null ? `${formatTusd8(parsedCap)} tUSD8` : "—"}</span>
          </div>
          <div className="confirm-row">
            <span>Expires</span>
            <span>{formatExpiry(expiresAt)}</span>
          </div>
          <div className="confirm-row">
            <span>Maximum loss if this key is stolen</span>
            <span>{parsedCap !== null ? `${formatTusd8(parsedCap)} tUSD8` : "—"}</span>
          </div>
        </div>
      )}

      {problems.map((problem) => (
        <p key={problem} className="error-text">
          {problem}
        </p>
      ))}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!formValid || busy}
        onClick={() => {
          if (!formValid || expiresAt === null || parsedMax === null || parsedCap === null) return;
          grantFlow.submit({
            address: VAULT_ADDRESS,
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
// Sessions: every key ever granted, with live state and one-click revoke.
// ---------------------------------------------------------------------------
function SessionsPanel({ vault, isOwner, now }: { vault: VaultData; isOwner: boolean; now: number }) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const revokeFlow = useWriteFlow(() => {
    vault.refresh();
    setRevoking(null);
  });

  return (
    <div className="panel panel-wide">
      <h3>Sessions</h3>
      <p className="panel-desc">
        Every session key ever granted to this vault, with its live on-chain
        state. Revoking is immediate and irreversible — a revoked key can
        never spend again.
      </p>

      {vault.loading && vault.sessions.length === 0 ? (
        <p className="muted">Loading sessions…</p>
      ) : vault.sessions.length === 0 ? (
        <div className="empty-state">
          No sessions have been granted yet. The owner can grant the first one
          above — a key, its recipients, its caps, and its expiry.
        </div>
      ) : (
        vault.sessions.map((session) => (
          <SessionRow
            key={session.key}
            session={session}
            isOwner={isOwner}
            now={now}
            revoking={revoking === session.key.toLowerCase()}
            onAskRevoke={() => setRevoking(session.key.toLowerCase())}
            onCancelRevoke={() => setRevoking(null)}
            onConfirmRevoke={() =>
              revokeFlow.submit({
                address: VAULT_ADDRESS,
                abi: spendGuardAbi,
                functionName: "revokeSession",
                args: [session.key],
              })
            }
            revokeBusy={revokeFlow.phase === "signing" || revokeFlow.phase === "confirming"}
          />
        ))
      )}

      <TxStatus
        phase={revokeFlow.phase}
        hash={revokeFlow.hash}
        errorMessage={revokeFlow.errorMessage}
        successLabel="Session revoked. The key can never spend again."
      />
    </div>
  );
}

function SessionRow({
  session,
  isOwner,
  now,
  revoking,
  onAskRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  revokeBusy,
}: {
  session: SessionState;
  isOwner: boolean;
  now: number;
  revoking: boolean;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  revokeBusy: boolean;
}) {
  const expired = Number(session.expiresAt) * 1000 <= now;
  const status = !session.active ? "Revoked" : expired ? "Expired" : "Active";
  const spentPct =
    session.spendCap > 0n ? Number((session.spent * 10000n) / session.spendCap) / 100 : 0;

  return (
    <div className="session-row">
      <div className="session-top">
        <a
          className="session-key"
          href={explorerAddressUrl(session.key)}
          target="_blank"
          rel="noreferrer"
        >
          {session.key}
        </a>
        <span className={`badge ${status === "Active" ? "badge-live" : ""}`}>{status}</span>
      </div>
      <div className="session-meta">
        <span>
          Spent <strong>{formatTusd8(session.spent)} tUSD8</strong> of{" "}
          <strong>{formatTusd8(session.spendCap)} tUSD8</strong>
        </span>
        <span>
          Remaining <strong>{formatTusd8(session.remainingCap)} tUSD8</strong>
        </span>
        <span>
          Max per payment <strong>{formatTusd8(session.maxPerTx)} tUSD8</strong>
        </span>
        <span>
          Expires <strong>{formatExpiry(session.expiresAt)}</strong>
        </span>
      </div>
      <div
        className="cap-bar"
        role="progressbar"
        aria-valuenow={Math.round(spentPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Spent ${spentPct.toFixed(1)} percent of cap`}
      >
        <div
          className={`cap-bar-fill ${spentPct >= 100 ? "full" : ""}`}
          style={{ width: `${Math.min(spentPct, 100)}%` }}
        />
      </div>
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
      {isOwner && session.active && (
        <div className="session-actions">
          {revoking ? (
            <div className="inline-confirm" style={{ marginTop: 0 }}>
              <span>Revoke this key immediately? It can never spend again.</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={revokeBusy}
                onClick={onConfirmRevoke}
              >
                {revokeBusy ? "Revoking…" : "Yes, revoke"}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={onCancelRevoke}>
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" onClick={onAskRevoke}>
              Revoke session
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent view: the connected wallet pays as its own session key.
// ---------------------------------------------------------------------------
function AgentPanel({
  vault,
  mySession,
  now,
}: {
  vault: VaultData;
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
        problems.push("The vault does not hold that much tUSD8 right now.");
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
          A granted key pays merchants within its bounds. The caller must be
          the key itself — no one can spend another key&apos;s session.
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
          A granted key pays merchants within its bounds. The caller must be
          the key itself — no one can spend another key&apos;s session.
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
            address: VAULT_ADDRESS,
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
function OwnerPanel({ vault, isOwner }: { vault: VaultData; isOwner: boolean }) {
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
                address: VAULT_ADDRESS,
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
                address: VAULT_ADDRESS,
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
                  address: VAULT_ADDRESS,
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
// The vault app section: network banner + all panels.
// ---------------------------------------------------------------------------
export function VaultApp({ vault }: { vault: VaultData }) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const wrongChain = isConnected && chainId !== aevumTestnet.id;
  const isOwner =
    isConnected && !!address && !!vault.owner && address.toLowerCase() === vault.owner.toLowerCase();
  const mySession =
    address != null
      ? (vault.sessions.find((s) => s.key.toLowerCase() === address.toLowerCase()) ?? null)
      : null;
  const { tokenBalance, allowance, refreshTokenData } = useWalletTokenData(address);

  return (
    <section className="section app-section" id="app">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Live vault</span>
          <h2 className="section-title">Use the vault</h2>
          <p className="section-sub">
            Everything below talks to the deployed contract on Aevum testnet.
            Reads are live without a wallet; writes need a connected wallet on
            chain 44005, and every revert is explained in plain language.
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

        <div className="app-grid">
          <DepositPanel
            vault={vault}
            tokenBalance={tokenBalance}
            allowance={allowance}
            refreshTokenData={refreshTokenData}
          />
          <GrantPanel vault={vault} isOwner={isOwner} />
          <AgentPanel vault={vault} mySession={mySession} now={now} />
          <OwnerPanel vault={vault} isOwner={isOwner} />
          <SessionsPanel vault={vault} isOwner={isOwner} now={now} />
        </div>
      </div>
    </section>
  );
}
