"use client";

import { useState } from "react";
import styles from "./paywall.module.css";

export type PaywallRestoreState = "idle" | "working" | "not_found" | "error";

export type PaywallProps = {
  /** False when this deployment has no Payment Link configured. */
  checkoutAvailable: boolean;
  restoreState: PaywallRestoreState;
  onCheckout: () => void;
  onRestore: (email: string) => void;
  onClose: () => void;
};

const RESTORE_NOTE: Record<PaywallRestoreState, string | null> = {
  idle: null,
  working: "Looking for your access…",
  not_found: "No active access for that address. Check the address you paid with.",
  error: "Couldn’t check that right now. Try again in a moment.",
};

function ShelfIllustration() {
  return (
    <svg className={styles.heroArt} viewBox="0 0 360 240" role="img" aria-label="Groceries framed for scanning">
      <defs>
        <linearGradient id="paywall-frame" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="1" stopColor="#e9edff" stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id="paywall-blue-pack" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#73b9ff" />
          <stop offset="1" stopColor="#377bdc" />
        </linearGradient>
        <linearGradient id="paywall-yogurt" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9c8ff" />
        </linearGradient>
        <linearGradient id="paywall-can" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#cbd7f6" />
          <stop offset="0.46" stopColor="#f1f4ff" />
          <stop offset="1" stopColor="#9eaed8" />
        </linearGradient>
        <linearGradient id="paywall-juice" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#ffc971" />
          <stop offset="1" stopColor="#f49b36" />
        </linearGradient>
        <linearGradient id="paywall-scan" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#7bb6ff" stopOpacity="0" />
          <stop offset="0.2" stopColor="#69aaff" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="0.8" stopColor="#69aaff" />
          <stop offset="1" stopColor="#7bb6ff" stopOpacity="0" />
        </linearGradient>
        <filter id="paywall-soft-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="9" stdDeviation="8" floodColor="#7087bc" floodOpacity="0.22" />
        </filter>
        <filter id="paywall-blue-glow" x="-30%" y="-300%" width="160%" height="700%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <g filter="url(#paywall-soft-shadow)">
        <rect x="20" y="18" width="320" height="188" rx="28" fill="url(#paywall-frame)" stroke="#ffffff" strokeWidth="6" />
        <rect x="9" y="185" width="342" height="31" rx="15.5" fill="#ffffff" />
        <path d="M27 211h306l-10 11H37z" fill="#cfddf7" opacity="0.72" />

        <g>
          <rect x="42" y="69" width="63" height="116" rx="5" fill="url(#paywall-blue-pack)" />
          <path d="M42 69h63l-9-8H51z" fill="#9bd4ff" />
          <circle cx="73.5" cy="127" r="24" fill="#f8fbff" opacity="0.95" />
          <path d="M58 133c8-16 22-17 31-2-3 17-26 21-31 2z" fill="#d8a45d" />
          <circle cx="63" cy="127" r="4" fill="#376ac6" />
          <circle cx="83" cy="124" r="4" fill="#ee6572" />
          <path d="M55 165h35" stroke="#e7f2ff" strokeWidth="5" strokeLinecap="round" />
        </g>

        <g>
          <path d="M112 101h54l-5 84h-44z" fill="url(#paywall-yogurt)" />
          <rect x="108" y="94" width="62" height="13" rx="6.5" fill="#ad92de" />
          <ellipse cx="139" cy="101" rx="25" ry="4.5" fill="#f7f2ff" />
          <path d="M126 143c7-13 20-13 27 0-7 11-20 11-27 0z" fill="#a66dd4" />
          <circle cx="140" cy="135" r="5" fill="#ef5c75" />
        </g>

        <g>
          <rect x="172" y="86" width="53" height="99" rx="10" fill="url(#paywall-can)" />
          <ellipse cx="198.5" cy="88" rx="26.5" ry="7" fill="#8e9dbd" />
          <ellipse cx="198.5" cy="88" rx="19" ry="4" fill="#cdd8ef" />
          <rect x="176" y="108" width="45" height="58" rx="8" fill="#fff3de" />
          <circle cx="198.5" cy="137" r="16" fill="#e84f4f" />
          <path d="M198 119c5-7 11-8 16-4-7 1-11 3-16 4z" fill="#4f9e64" />
        </g>

        <g>
          <rect x="235" y="69" width="45" height="116" rx="12" fill="url(#paywall-juice)" />
          <rect x="241" y="58" width="33" height="17" rx="6" fill="#ee7650" />
          <rect x="237" y="111" width="41" height="51" rx="7" fill="#fff7ea" opacity="0.95" />
          <circle cx="257.5" cy="137" r="12" fill="#ff8d35" />
          <path d="M259 124c4-7 10-8 15-4-7 1-10 3-15 4z" fill="#4da66a" />
        </g>

        <g>
          <path d="M290 76c0-11 7-18 17-18h11c10 0 17 7 17 18v109h-45z" fill="#f8fbff" />
          <rect x="299" y="57" width="27" height="14" rx="5" fill="#4f84e8" />
          <rect x="294" y="118" width="37" height="48" rx="7" fill="#76a8f1" />
          <path d="M294 142c11-10 22-10 37-3v27h-37z" fill="#447bd0" opacity="0.78" />
          <rect x="306" y="129" width="13" height="24" rx="4" fill="#ffffff" opacity="0.92" />
        </g>
      </g>

      <rect x="20" y="133" width="320" height="7" rx="3.5" fill="url(#paywall-scan)" opacity="0.72" filter="url(#paywall-blue-glow)" />
      <rect x="28" y="135" width="304" height="2" rx="1" fill="url(#paywall-scan)" />
      <path className={styles.scanCorner} d="M22 120v-11c0-12 8-20 20-20h11M338 120v-11c0-12-8-20-20-20h-11M22 151v11c0 12 8 20 20 20h11M338 151v11c0 12-8 20-20 20h-11" />
    </svg>
  );
}

/**
 * Shown once the free allowance is used up.
 *
 * "Restore access" is not a nicety: a buyer who pays inside the Instagram
 * browser and later opens the same link in Safari arrives with empty storage,
 * and this is how they get back what they paid for.
 */
export default function Paywall({ checkoutAvailable, restoreState, onCheckout, onRestore, onClose }: PaywallProps) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [email, setEmail] = useState("");
  const note = RESTORE_NOTE[restoreState];

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Get seven days of unlimited scans">
      <button className={styles.close} type="button" onClick={onClose} aria-label="Close">×</button>
      <div className={styles.shell}>
        <div className={styles.hero}>
          <ShelfIllustration />
        </div>

        <div className={styles.content}>
          <p className={styles.used}>You’ve used your free scans.</p>
          <h1 className={styles.title}>Keep scanning<br />all week.</h1>
          <p className={styles.body}>Get unlimited scans for 7 days and see what’s really in the groceries you buy.</p>

          <div className={styles.offer}>
            <button className={styles.checkout} type="button" disabled={!checkoutAvailable} onClick={onCheckout}>
              Start now
            </button>
            <p className={styles.price}>Unlimited scans for 7 days · $2.99 once</p>
            {!checkoutAvailable ? <p className={styles.unavailable} role="status">Payments aren’t available right now. Please try again later.</p> : null}
          </div>

          {restoreOpen ? (
            <form
              className={styles.restore}
              onSubmit={(event) => {
                event.preventDefault();
                if (email.trim().length > 0) onRestore(email.trim());
              }}
            >
              <input
                type="email"
                required
                maxLength={254}
                inputMode="email"
                autoComplete="email"
                placeholder="The email you paid with"
                aria-label="The email you paid with"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" disabled={restoreState === "working"}>
                {restoreState === "working" ? "Restoring…" : "Restore access"}
              </button>
              {note ? (
                <p role="status" className={`${styles.restoreNote} ${restoreState === "not_found" || restoreState === "error" ? styles.restoreError : ""}`}>
                  {note}
                </p>
              ) : null}
            </form>
          ) : (
            <button className={styles.restoreToggle} type="button" onClick={() => setRestoreOpen(true)}>
              Already paid on another browser?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
