// SpendGuard's own 404: the key that fits nowhere. The vault door is
// the 0 in 404, a key floats beside it, and tapping the door makes the
// key try anyway (and fail). No wallet, no chain reads, just a way home.
"use client";

import { useState } from "react";
import { Key } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { APP_URL, BASE_PATH } from "@/lib/site";

export default function NotFound() {
  const [denied, setDenied] = useState(0);
  const [showNope, setShowNope] = useState(false);

  const tryDoor = () => {
    setDenied((n) => n + 1);
    setShowNope(true);
    window.setTimeout(() => setShowNope(false), 1400);
  };

  return (
    <section className="not-found">
      <Navbar />
      <div className="nf-wrap">
        <p className="nf-eyebrow">Error 404 · Lost key</p>
        <div className="nf-scene">
          <span className="nf-glow" aria-hidden="true" />
          <div className="nf-404">
            <span className="nf-four" aria-hidden="true">
              4
            </span>
            <span className="nf-door-wrap">
              <span className="nf-dial" aria-hidden="true" />
              <button
                type="button"
                className="nf-door"
                onClick={tryDoor}
                aria-label="Try the vault door"
              >
                <svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true">
                  <g fill="#fff">
                    <circle cx="32" cy="25" r="8.5" />
                    <path d="M27.5 28H36.5L40 43.5Q40.4 47 36.6 47H27.4Q23.6 47 24 43.5Z" />
                  </g>
                </svg>
              </button>
            </span>
            <span className="nf-four" aria-hidden="true">
              4
            </span>
          </div>
          <span className="nf-key">
            <Key
              key={denied}
              size={52}
              aria-hidden="true"
              className={denied > 0 ? "nf-shake" : ""}
            />
          </span>
          <span className="nf-spark nf-spark-1" aria-hidden="true" />
          <span className="nf-spark nf-spark-2" aria-hidden="true" />
          <span className="nf-spark nf-spark-3" aria-hidden="true" />
          {showNope && <span className="nf-nope">Nope, wrong key.</span>}
        </div>
        <h1 className="nf-title">This key opens nothing.</h1>
        <p className="nf-sub">
          The page you are looking for is not in this vault. It may have
          been revoked, moved, or it never existed.
        </p>
        <div className="nf-actions">
          <a className="btn btn-primary" href={`${BASE_PATH}/`}>
            Take me home
          </a>
          <a className="btn btn-outline" href={APP_URL}>
            Open the app
          </a>
        </div>
        <p className="nf-hint">Tip: tap the vault door. The key will try anyway.</p>
      </div>
    </section>
  );
}
