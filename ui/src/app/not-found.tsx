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
      <Navbar hideConnect />
      <div className="nf-wrap">
        <p className="nf-eyebrow">Error 404 · Lost key</p>
        <div className="nf-scene">
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
                <svg
                  viewBox="0 0 64 64"
                  width="46"
                  height="46"
                  aria-hidden="true"
                  key={denied}
                  className={denied > 0 ? "nf-door-shake" : ""}
                >
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
          {showNope && <span className="nf-nope">Nope, wrong key.</span>}
        </div>
        <h1 className="nf-title">This key opens nothing.</h1>
        <p className="nf-sub">
          The page you followed does not exist. It may have moved, or the
          link was never quite right.
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
