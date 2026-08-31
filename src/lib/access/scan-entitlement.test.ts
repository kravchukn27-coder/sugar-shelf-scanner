import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_PASS_KEY,
  FREE_SCANS_KEY,
  FREE_SCAN_LIMIT,
  clearExpiredAccessPass,
  readActiveAccessPass,
  readEntitlement,
  recordCompletedScan,
  storeAccessPass,
  type EntitlementStorage,
} from "./scan-entitlement";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const TOKEN = "a".repeat(48);

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage: EntitlementStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
  return { storage, map };
}

const blockedStorage: EntitlementStorage = {
  getItem() { throw new Error("site data blocked"); },
  setItem() { throw new Error("site data blocked"); },
  removeItem() { throw new Error("site data blocked"); },
};

test("a fresh browser gets the full free allowance", () => {
  const { storage } = memoryStorage();
  assert.deepEqual(readEntitlement(storage, NOW), {
    paid: false,
    freeScansUsed: 0,
    freeScansRemaining: FREE_SCAN_LIMIT,
    mustPay: false,
  });
});

test("free scans are consumed and then require payment", () => {
  const { storage, map } = memoryStorage();
  for (let scan = 1; scan <= FREE_SCAN_LIMIT; scan += 1) {
    const entitlement = recordCompletedScan(storage, NOW);
    assert.equal(entitlement.freeScansUsed, scan);
    assert.equal(entitlement.mustPay, scan === FREE_SCAN_LIMIT);
  }
  assert.equal(map.get(FREE_SCANS_KEY), String(FREE_SCAN_LIMIT));
  // An extra call must not push the counter past the limit.
  assert.equal(recordCompletedScan(storage, NOW).freeScansUsed, FREE_SCAN_LIMIT);
});

test("an active pass overrides an exhausted free allowance", () => {
  const { storage } = memoryStorage({ [FREE_SCANS_KEY]: String(FREE_SCAN_LIMIT) });
  storeAccessPass(storage, { token: TOKEN, expiresAt: "2026-09-08T12:00:00.000Z" });
  const entitlement = readEntitlement(storage, NOW);
  assert.equal(entitlement.paid, true);
  assert.equal(entitlement.mustPay, false);
  assert.equal(entitlement.freeScansRemaining, null);
  // A paid scan must not burn free allowance that the user may need later.
  assert.equal(recordCompletedScan(storage, NOW).freeScansUsed, FREE_SCAN_LIMIT);
});

test("an expired pass stops granting access and is cleared", () => {
  const { storage, map } = memoryStorage({ [FREE_SCANS_KEY]: String(FREE_SCAN_LIMIT) });
  storeAccessPass(storage, { token: TOKEN, expiresAt: "2026-08-25T12:00:00.000Z" });
  assert.equal(readActiveAccessPass(storage, NOW), null);
  assert.equal(readEntitlement(storage, NOW).mustPay, true);
  clearExpiredAccessPass(storage, NOW);
  assert.equal(map.has(ACCESS_PASS_KEY), false);
});

test("corrupt stored values are ignored rather than trusted", () => {
  const { storage } = memoryStorage({ [FREE_SCANS_KEY]: "not-a-number", [ACCESS_PASS_KEY]: "{oops" });
  const entitlement = readEntitlement(storage, NOW);
  assert.equal(entitlement.paid, false);
  assert.equal(entitlement.freeScansUsed, 0);
});

test("blocked storage never blocks scanning", () => {
  // Private mode must fail toward letting the user scan, the same way the
  // onboarding intro falls through to being shown.
  const entitlement = readEntitlement(blockedStorage, NOW);
  assert.equal(entitlement.mustPay, false);
  assert.equal(readEntitlement(null, NOW).mustPay, false);
  assert.doesNotThrow(() => recordCompletedScan(blockedStorage, NOW));
});
