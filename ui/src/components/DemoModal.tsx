"use client";

import { useEffect } from "react";
import { DEMO_VIDEO_URL } from "@/lib/config";
import { APP_URL } from "@/lib/site";

export function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="SpendGuard demo video"
      onClick={onClose}
    >
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close" autoFocus>
          ×
        </button>
        <h3>SpendGuard demo</h3>
        {DEMO_VIDEO_URL ? (
          <>
            <p>
              The full flow on Aevum testnet: deposit, grant, a payment
              within the cap, an over-cap payment reverting, a revoke, and
              the owner sweep. Every step shows its transaction hash.
            </p>
            <video className="modal-video" src={DEMO_VIDEO_URL} controls playsInline />
          </>
        ) : (
          <>
            <p>
              The demo video is being recorded against the live testnet
              deployment. It shows the full flow: deposit, grant, a payment
              within the cap, an over-cap payment reverting on camera, a
              revoke, and the owner sweep. Every step shows its transaction
              hash.
            </p>
            <div className="modal-placeholder">
              <strong>Demo video coming soon</strong>
              <span>
                The vault is live on Aevum testnet now. Open the app page,
                connect a wallet, and try the real flow. Grant a session,
                pay within the cap, and watch the caps hold.
              </span>
            </div>
            <p style={{ marginTop: 16 }}>
              <a href={APP_URL} onClick={onClose}>
                Try the live vault →
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
