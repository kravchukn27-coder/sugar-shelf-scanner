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
  error: "Couldn't check that right now. Try again in a moment.",
};

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
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Unlock unlimited scans">
      <button className={styles.close} type="button" onClick={onClose} aria-label="Close">×</button>
      <h1 className={styles.title}>You've used your free scans</h1>
      <p className={styles.body}>
        Unlimited scanning for 7 days. One payment of $2.99 — nothing renews and there is no subscription.
      </p>
      <button className={styles.checkout} type="button" disabled={!checkoutAvailable} onClick={onCheckout}>
        Get 7 days — $2.99
      </button>
      <p className={styles.fineprint}>
        {checkoutAvailable
          ? "This is a demo. Always check the package label before a dietary decision."
          : "Payments aren't available right now. Please try again later."}
      </p>

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
  );
}
