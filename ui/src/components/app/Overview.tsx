"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, KeyRound } from "lucide-react";
import { formatTusd8, shortenAddress } from "@/lib/format";
import { timeLeft } from "@/lib/blockTimes";
import { getKeyLabel, useKeyLabels } from "@/lib/keyLabels";
import { DepositPanel } from "@/components/VaultApp";
import { ActivityFeed } from "./ActivityFeed";
import { useApp } from "./AppProvider";
import { Modal } from "./Modal";
import { UsageMeter } from "./UsageMeter";

function Skeleton({ w = "6ch" }: { w?: string }) {
  return <span className="skeleton" style={{ width: w }} aria-hidden="true" />;
}

export function Overview() {
  const app = useApp();
  const { vault, now, selected } = app;
  const { labels } = useKeyLabels();
  const [depositOpen, setDepositOpen] = useState(false);

  const live = useMemo(
    () => vault.sessions.filter((s) => s.active && Number(s.expiresAt) * 1000 > now),
    [vault.sessions, now],
  );
  const paidOut = useMemo(() => vault.sessions.reduce((sum, s) => sum + s.spent, 0n), [vault.sessions]);
  const balance = vault.balance;
  // Caps are limits, not reservations: the most keys can take is the smaller
  // of what the vault holds and what their caps still allow.
  const capRoom = useMemo(() => live.reduce((sum, s) => sum + s.remainingCap, 0n), [live]);
  const atRisk = balance === null ? null : capRoom < balance ? capRoom : balance;
  const protectedAmt = balance === null || atRisk === null ? null : balance - atRisk;
  // The bar is the vault balance, nothing else: blue (what keys can still
  // take) plus green (only the owner can move). It always adds up to what the
  // vault holds right now. What keys already paid out is history, not part
  // of this balance: it belongs to past funding rounds, and a sweep plus a
  // fresh deposit would otherwise mix old payouts into the new balance.
  // Tiny non-zero segments stay visible.
  const barTotal = balance;
  const pctOf = (part: bigint) =>
    barTotal === null || barTotal === 0n ? 0 : Number((part * 1000n) / barTotal) / 10;
  const riskPct =
    atRisk === null
      ? 0
      : atRisk > 0n && pctOf(atRisk) < 1.5
        ? 1.5
        : pctOf(atRisk);

  const nextExpiry = useMemo(() => {
    if (live.length === 0) return null;
    return [...live].sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))[0];
  }, [live]);

  const keyCards = useMemo(
    () =>
      [...vault.sessions]
        .sort((a, b) => {
          const aLive = a.active && Number(a.expiresAt) * 1000 > now ? 1 : 0;
          const bLive = b.active && Number(b.expiresAt) * 1000 > now ? 1 : 0;
          if (aLive !== bLive) return bLive - aLive;
          return a.spent < b.spent ? 1 : a.spent > b.spent ? -1 : 0;
        })
        .slice(0, 3),
    [vault.sessions, now],
  );

  const firstLoad = vault.loading && balance === null;

  return (
    <div className="ov">
      {vault.error && (
        <div className="info-banner info-banner-warn" role="status">
          <div>
            <strong>Live data could not be refreshed.</strong> Showing the last known values.
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={vault.refresh}>
            Retry
          </button>
        </div>
      )}

      <section className="ov-top">
        <div className="card ov-balance">
          <p className="card-label">Vault balance</p>
          <p className="ov-big">
            {firstLoad || balance === null ? <Skeleton w="7ch" /> : formatTusd8(balance)}
            <small>tUSD8</small>
          </p>
          <p className="card-note">Held by the vault contract. Only the owner can move it out.</p>
          <div className="ov-actions">
            <button type="button" className="btn btn-primary" onClick={() => setDepositOpen(true)}>
              <ArrowDownToLine size={18} strokeWidth={1.8} aria-hidden="true" />
              Deposit
            </button>
            {app.isConnected && app.isOwner && (
              <Link href="/app/keys/#grant" className="btn btn-outline">
                <KeyRound size={18} strokeWidth={1.8} aria-hidden="true" />
                Grant a key
              </Link>
            )}
            <Link href="/app/settings/" className="btn btn-outline">
              <ArrowUpFromLine size={18} strokeWidth={1.8} aria-hidden="true" />
              Sweep or pause
            </Link>
          </div>
          <dl className="ov-stats" aria-label="Summary">
            <div>
              <dt>Active keys</dt>
              <dd>{firstLoad ? <Skeleton w="2ch" /> : live.length}</dd>
              <dd className="ov-stat-sub">{vault.grantsCount} granted</dd>
            </div>
            <div>
              <dt>Payments</dt>
              <dd>{firstLoad ? <Skeleton w="2ch" /> : vault.paymentsCount}</dd>
              <dd className="ov-stat-sub">within limits</dd>
            </div>
            <div>
              <dt>Next expiry</dt>
              <dd>{nextExpiry ? timeLeft(nextExpiry.expiresAt, now) : "None"}</dd>
              <dd className="ov-stat-sub">
                {nextExpiry
                  ? (getKeyLabel(labels, selected, nextExpiry.key) ?? shortenAddress(nextExpiry.key))
                  : "no active keys"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="card ov-exposure">
          <p className="card-label">What keys can still take</p>
          <p className="ov-mid">
            {firstLoad || atRisk === null ? <Skeleton w="6ch" /> : formatTusd8(atRisk)}
            <small>tUSD8 at most</small>
          </p>
          <div
            className="split"
            role="img"
            aria-label={
              balance === null || atRisk === null
                ? "Loading"
                : `Vault holds ${formatTusd8(balance)} tUSD8. Keys can still take at most ${formatTusd8(atRisk)}, and ${formatTusd8(protectedAmt ?? 0n)} only the owner can move. Keys have paid out ${formatTusd8(paidOut)} so far`
            }
          >
            <span className="split-risk" style={{ width: `${riskPct}%` }} />
          </div>
          <dl className="legend">
            <div>
              <dt>
                <i className="dot dot-risk" />
                Still spendable by keys
              </dt>
              <dd>{atRisk === null ? "…" : formatTusd8(atRisk)}</dd>
            </div>
            <div>
              <dt>
                <i className="dot dot-safe" />
                Only the owner can move
              </dt>
              <dd>{protectedAmt === null ? "…" : formatTusd8(protectedAmt)}</dd>
            </div>
            <div className="legend-history">
              <dt>
                <i className="dot dot-out" />
                Already paid out by keys
              </dt>
              <dd>{formatTusd8(paidOut)}</dd>
            </div>
          </dl>
          <p className="card-note">
            Caps are limits, not reservations: keys can never take more than the vault holds.
          </p>
        </div>
      </section>

      <section>
        <div className="sec-head">
          <h2>Access keys</h2>
          <Link href="/app/keys/">Manage keys</Link>
        </div>
        {keyCards.length === 0 ? (
          <div className="card empty-card">
            <p className="empty-title">{firstLoad ? "Loading keys…" : "No keys yet"}</p>
            {!firstLoad && (
              <>
                <p className="card-note">
                  A key lets an agent pay approved recipients within a cap, until an expiry. You can
                  revoke it any time.
                </p>
                <Link href="/app/keys/#grant" className="btn btn-primary btn-sm">
                  Grant the first key
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="key-cards">
            {keyCards.map((s) => {
              const expired = Number(s.expiresAt) * 1000 <= now;
              const status = !s.active ? "Revoked" : expired ? "Expired" : vault.paused ? "Frozen" : "Active";
              return (
                <Link key={s.key} href="/app/keys/" className={`card key-card${status === "Active" || status === "Frozen" ? "" : " key-card-ended"}`}>
                  <div className="key-card-top">
                    <div>
                      <p className="key-name">{getKeyLabel(labels, selected, s.key) ?? "Unnamed key"}</p>
                      <p className="key-addr">{shortenAddress(s.key)}</p>
                    </div>
                    {status !== "Active" && <span className="badge">{status}</span>}
                  </div>
                  <UsageMeter session={s} vaultBalance={balance} now={now} />
                  <p className="key-card-foot">
                    {status === "Active" || status === "Frozen" ? `Expires in ${timeLeft(s.expiresAt, now)}` : "Ended"} · {s.recipients.length}{" "}
                    {s.recipients.length === 1 ? "recipient" : "recipients"}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="sec-head">
          <h2>Recent activity</h2>
          <Link href="/app/activity/">See all</Link>
        </div>
        {vault.activity.length === 0 ? (
          <div className="card empty-card">
            <p className="empty-title">{vault.loading ? "Loading activity…" : "No activity yet"}</p>
            {!vault.loading && (
              <p className="card-note">Deposits, grants, payments and revokes appear here as they happen.</p>
            )}
          </div>
        ) : (
          <div className="card feed-card">
            <ActivityFeed items={vault.activity.slice(0, 5)} />
          </div>
        )}
      </section>

      {depositOpen && (
        <Modal title="Deposit tUSD8" onClose={() => setDepositOpen(false)}>
          <DepositPanel
            vault={vault}
            vaultAddress={selected}
            isOwner={app.isOwner}
            tokenBalance={app.tokenBalance}
            allowance={app.allowance}
            refreshTokenData={app.refreshTokenData}
            onDone={() => setDepositOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}
