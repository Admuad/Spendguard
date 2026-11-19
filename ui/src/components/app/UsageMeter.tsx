"use client";

import { formatTusd8 } from "@/lib/format";
import type { SessionState } from "@/lib/useVaultData";

type Tone = "ok" | "warn" | "bad" | "ended";

/** Percent of the cap already spent, 0 to 100, to one decimal place. */
export function spentPercent(session: SessionState): number {
  if (session.spendCap <= 0n) return 0;
  return Math.min(100, Number((session.spent * 10000n) / session.spendCap) / 100);
}

/** Percent of the cap a bar should show. Tiny non-zero values stay visible. */
function barPct(pct: number, spent: bigint): number {
  if (spent > 0n && pct < 1.5) return 1.5;
  return pct;
}

function formatPct(pct: number): string {
  return pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
}

/**
 * Token usage for one session key.
 *  - Headline: what the key can still spend.
 *  - Bar: spent / cap. Colour is a status (blue < 70%, amber 70-90%, red 90%+),
 *    and the percentage is always written out, so colour is never the only signal.
 *  - Tick: the per-payment limit, as a fraction of the cap.
 *  - Hatched tail: the part of the remaining cap the vault cannot cover right now.
 */
export function UsageMeter({
  session,
  vaultBalance,
  now,
  totalSpent,
}: {
  session: SessionState;
  vaultBalance: bigint | null;
  now: number;
  totalSpent?: bigint;
}) {
  const expired = Number(session.expiresAt) * 1000 <= now;
  const ended = !session.active || expired;
  const pct = spentPercent(session);
  const tone: Tone = ended ? "ended" : pct >= 90 ? "bad" : pct >= 70 ? "warn" : "ok";
  const fillPct = barPct(pct, session.spent);

  const limitedByVault =
    !ended && vaultBalance !== null && session.remainingCap > vaultBalance;
  const spendableNow = limitedByVault && vaultBalance !== null ? vaultBalance : session.remainingCap;
  const hatchStart =
    limitedByVault && session.spendCap > 0n
      ? Math.min(100, ((Number(session.spent) + Number(spendableNow)) / Number(session.spendCap)) * 100)
      : 100;

  const tickPct =
    session.spendCap > 0n
      ? Math.min(100, (Number(session.maxPerTx) / Number(session.spendCap)) * 100)
      : 100;
  const tickNearStart = tickPct < 22;
  const tickNearEnd = tickPct > 78;

  const headline = ended
    ? `${formatTusd8(session.spent)} spent`
    : `${formatTusd8(session.remainingCap)} left`;
  const side = ended
    ? `of ${formatTusd8(session.spendCap)} tUSD8 · ${!session.active ? "revoked" : "expired"}`
    : pct >= 100
      ? `of ${formatTusd8(session.spendCap)} tUSD8 · cap reached`
      : limitedByVault
        ? `of ${formatTusd8(session.spendCap)} tUSD8 · only ${formatTusd8(spendableNow)} spendable now`
        : `of ${formatTusd8(session.spendCap)} tUSD8 · ${formatPct(pct)}% used`;

  const sharePct =
    totalSpent !== undefined && totalSpent > 0n
      ? Number((session.spent * 1000n) / totalSpent) / 10
      : null;

  return (
    <div className={`um um-${tone}`}>
      <div className="um-head">
        <strong className="um-left">{headline}</strong>
        <span className="um-side">{side}</span>
      </div>
      <div
        className="um-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={Number(session.spendCap)}
        aria-valuenow={Number(session.spent)}
        aria-label={`${formatTusd8(session.spent)} of ${formatTusd8(session.spendCap)} tUSD8 spent, ${formatPct(pct)} percent`}
      >
        <div className="um-fill" style={{ width: `${fillPct}%` }} />
        {limitedByVault && hatchStart < 100 && (
          <div className="um-hatch" style={{ left: `${hatchStart}%` }} />
        )}
        {!ended && <div className="um-tick" style={{ left: `${tickPct}%` }} />}
      </div>
      {!ended && (
        <div
          className={`um-tick-label${tickNearStart ? " start" : ""}${tickNearEnd ? " end" : ""}`}
          style={tickNearStart || tickNearEnd ? undefined : { left: `${tickPct}%` }}
        >
          {formatTusd8(session.maxPerTx)} max per payment
        </div>
      )}
      <div className="um-facts">
        <span>
          Spent <strong>{formatTusd8(session.spent)}</strong>
        </span>
        <span>
          Per payment <strong>{formatTusd8(session.maxPerTx)}</strong>
        </span>
        {sharePct !== null && (
          <span>
            Share of spending <strong>{sharePct.toFixed(1)}%</strong>
          </span>
        )}
      </div>
    </div>
  );
}
