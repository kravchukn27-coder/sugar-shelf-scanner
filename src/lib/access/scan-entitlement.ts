/**
 * Browser-side scan entitlement for the monetization test.
 *
 * The free allowance lives only in this browser's storage, so it resets when
 * the user switches browsers or clears site data. That leak is deliberate: a
 * scan costs a fraction of a cent, while server-side identity would cost
 * conversion and would conflict with the scanner's no-identifier telemetry
 * contract. Someone determined enough to reset it is a demand signal, not a
 * cost problem.
 *
 * A paid pass is the opposite case. It is issued and stored server-side and is
 * restorable from any browser by the address the buyer paid with, so browser
 * storage is never the only copy of something a user paid for.
 */

export const FREE_SCAN_LIMIT = 3;
export const FREE_SCANS_KEY = "sugar:free-scans:v1";
export const ACCESS_PASS_KEY = "sugar:access-pass:v1";

/** The subset of the Storage interface this module needs, so it is testable. */
export interface EntitlementStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StoredAccessPass = { token: string; expiresAt: string };

export type Entitlement = {
  paid: boolean;
  freeScansUsed: number;
  /** Null while paid: a pass has no scan ceiling inside its window. */
  freeScansRemaining: number | null;
  /** True when the next scan must be preceded by payment. */
  mustPay: boolean;
};

const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

function safeRead(storage: EntitlementStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(storage: EntitlementStorage | null, key: string, value: string) {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Blocked site data must not stop the scan the user came here for.
  }
}

function safeRemove(storage: EntitlementStorage | null, key: string) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to recover from: the value simply stays until storage works.
  }
}

function parsePass(raw: string | null): StoredAccessPass | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { token, expiresAt } = parsed as { token?: unknown; expiresAt?: unknown };
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) return null;
  return { token, expiresAt };
}

export function readActiveAccessPass(storage: EntitlementStorage | null, now: Date): StoredAccessPass | null {
  const pass = parsePass(safeRead(storage, ACCESS_PASS_KEY));
  if (!pass) return null;
  return Date.parse(pass.expiresAt) > now.getTime() ? pass : null;
}

function readFreeScansUsed(storage: EntitlementStorage | null): number {
  const raw = safeRead(storage, FREE_SCANS_KEY);
  if (raw === null) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, FREE_SCAN_LIMIT);
}

export function readEntitlement(storage: EntitlementStorage | null, now: Date): Entitlement {
  const freeScansUsed = readFreeScansUsed(storage);
  if (readActiveAccessPass(storage, now)) {
    return { paid: true, freeScansUsed, freeScansRemaining: null, mustPay: false };
  }
  return {
    paid: false,
    freeScansUsed,
    freeScansRemaining: Math.max(0, FREE_SCAN_LIMIT - freeScansUsed),
    mustPay: freeScansUsed >= FREE_SCAN_LIMIT,
  };
}

/**
 * Call this when a scan actually produced a result. A failed or abandoned
 * scan must not consume the allowance: the user would be paying for our
 * error, and the funnel numbers would stop meaning what they say.
 */
export function recordCompletedScan(storage: EntitlementStorage | null, now: Date): Entitlement {
  if (readActiveAccessPass(storage, now)) return readEntitlement(storage, now);
  const used = Math.min(readFreeScansUsed(storage) + 1, FREE_SCAN_LIMIT);
  safeWrite(storage, FREE_SCANS_KEY, String(used));
  return readEntitlement(storage, now);
}

export function storeAccessPass(storage: EntitlementStorage | null, pass: StoredAccessPass) {
  safeWrite(storage, ACCESS_PASS_KEY, JSON.stringify(pass));
}

/** Keeps a lapsed pass from sitting in storage forever after the window ends. */
export function clearExpiredAccessPass(storage: EntitlementStorage | null, now: Date) {
  if (parsePass(safeRead(storage, ACCESS_PASS_KEY)) && !readActiveAccessPass(storage, now)) {
    safeRemove(storage, ACCESS_PASS_KEY);
  }
}
