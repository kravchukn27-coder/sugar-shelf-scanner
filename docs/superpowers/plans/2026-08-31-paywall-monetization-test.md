# Paywall Monetization Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать сканеру три бесплатных скана на браузер и платный доступ на 7 дней за $2.99, оплачиваемый через Stripe Payment Link, чтобы измерить конверсию платного трафика из Meta и стоимость одного платящего.

**Architecture:** Бесплатный лимит живёт только в `localStorage` и намеренно сбрасывается при смене браузера — скан стоит доли цента, а серверная идентификация стоила бы конверсии и нарушала бы контракт телеметрии «без идентификаторов». Оплаченный доступ устроен наоборот: Stripe Payment Link возвращает человека на наш адрес с `?checkout=<session_id>`, сервер проверяет сессию в Stripe REST API и выдаёт токен доступа, который лежит в PostgreSQL вместе с HMAC-дайджестом почты покупателя. Поэтому доступ восстанавливается в любом браузере по той же почте, которой платили, и ни одна оплата не теряется вместе с хранилищем браузера. Вебхуков, платёжного SDK и писем нет: вся фича сносится удалением четырёх файлов и одной таблицы.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.8, zod 3.24, `pg`, `tsx --test` (node:test), Stripe REST API через обычный `fetch`.

## Global Constraints

- Node.js >= 20.9. Никаких новых зависимостей в `package.json`: Stripe вызывается через `fetch`, иконки режутся системным `sips`.
- Тесты — только `node:test` + `node:assert/strict`, файлы `src/**/*.test.ts`. Запуск: `npm test`.
- Импорты внутри `src` — через алиас `@/`.
- Текст интерфейса — английский, как во всём приложении. Комментарии и сообщения коммитов — английские.
- Приватность: в `access_passes` не попадают ни адрес почты в открытом виде, ни IP, ни данные сканов. В stdout не попадает ничего, кроме уже разрешённых событий из `resultMetricsSchema`.
- Пейвол выключен по умолчанию. Он включается только сборочным флагом `NEXT_PUBLIC_PAYWALL_ENABLED=true`; при выключенном флаге поведение приложения не меняется ни на байт.
- `NEXT_PUBLIC_*` читается только литералом `process.env.NEXT_PUBLIC_X` на верхнем уровне модуля — иначе Next не подставит значение в браузерную сборку.
- Цена, валюта и текст чека настраиваются в панели Stripe, а не в коде. В коде цена появляется только как строка в интерфейсе.
- Валюта — **USD**. Основной рынок продукта американский; евро в интерфейсе быть не должно нигде.

## Порядок выполнения

**Задача 0 — ручная, блокирует всё остальное.** Пока она не закрыта, писать код бессмысленно.

**Волна 1 — задачи 1–7 идут параллельно.** Ни одна пара из них не трогает общий файл. Можно раздать семи агентам одновременно.

**Волна 2 — задачи 8–10 строго последовательно.** Задача 8 нужна задаче 9; задача 9 — единственная, кто правит `src/app/page.tsx`, поэтому она одна и в один момент времени.

| Задача | Файлы | Зависит от |
| --- | --- | --- |
| 1. Переменные окружения | `src/lib/env.ts`, `.env.example` | — |
| 2. Клиентский учёт сканов | `src/lib/access/scan-entitlement.ts` | — |
| 3. Хранилище пропусков | `db/migrations/006_access_passes.sql`, `src/lib/access/access-pass.ts` | — |
| 4. Проверка оплаты в Stripe | `src/lib/access/stripe-checkout.ts` | — |
| 5. События телеметрии | `src/lib/observability/result-metrics.ts` | — |
| 6. Экран пейвола | `src/app/paywall.tsx`, `src/app/paywall.module.css` | — |
| 7. Иконки и установка на экран | `src/lib/icons/`, `scripts/`, `public/`, `src/app/layout.tsx`, `package.json` | — |
| 8. API-маршруты | `src/app/api/access/*`, `src/lib/observability/scan-route.ts` | 1, 3, 4 |
| 9. Подключение в сканер | `src/app/page.tsx` | 2, 5, 6, 8 |
| 10. Документация | `docs/*` | 9 |

---

## Task 0: Ручные проверки до написания кода

**Files:** нет. Это операционная задача для Александры и Алексея.

**Interfaces:**
- Produces: адрес домена, URL платёжной ссылки Stripe, ключ `STRIPE_SECRET_KEY`, ответ на вопрос «работает ли камера во встроенном браузере Instagram».

- [x] **Step 1: Проверить камеру во встроенном браузере Instagram**

Отправить ссылку на прод самому себе в Instagram Direct, открыть **из Instagram** (не копируя в Safari), нажать Start.

**Результат получен 31.08.2026: камера в браузере Instagram работает.** Основной
путь остаётся камерным, задача 9 закрывает пейволом и Start, и галерею, как
написано. Запасной вариант — ставить пейвол только на загрузку фото — не нужен.

Осталось повторить проверку в Facebook: у него отдельный встроенный браузер со
своим хранилищем.

- [ ] **Step 2: Проверить, есть ли Apple Pay в форме Stripe внутри Instagram**

Дойти до формы оплаты во встроенном браузере. Записать, предлагается ли Apple Pay или только ручной ввод карты. Если только карта — это ожидаемо, и вывод теста надо будет читать как нижнюю границу конверсии.

- [x] **Step 3: Решить вопрос домена**

Домен не блокирует тест. Карту вводят не у нас: Payment Link уводит покупателя
на `checkout.stripe.com`, и на наш адрес он возвращается уже после оплаты — так
что аргумента про доверие к форме оплаты здесь нет.

Реальный риск другой: модерация рекламы Meta заметно чаще заворачивает
объявления на сырой поддомен хостинга вида `*.up.railway.app`, чем на обычный
домен.

**Решение принято 31.08.2026: весь тест идёт на
`https://sugar-api-production.up.railway.app`, домен не заводим.** Причина
выбрать заранее была в том, что бесплатный лимит и пропуска привязаны к адресу
сайта: переезд посреди теста обнулил бы счётчики у всех и разорвал цифры на «до»
и «после». Теперь этого не случится.

Единственное, что может это пересмотреть, — отклонение объявления модерацией
Meta именно из-за адреса. Тогда домен заводится до старта трафика, а не
посреди него.

- [x] **Step 4: Создать Payment Link в панели Stripe**

**Сделано 31.08.2026.** Товар `Shelf Scanner — 7 days unlimited`, разовый платёж
**$2.99 USD**, сбор email включён (он включён по умолчанию и нужен для
восстановления доступа), картинка — иконка приложения Sugar.no. Ни одна из
опций сбора данных не отмечена: имя, адрес, телефон и Managed Payments (+3,5%)
только режут конверсию, а нужна нам одна почта.

Способы оплаты сведены к четырём привычным американцу: Card, Apple Pay,
Google Pay, Link. Европейские (Bancontact, EPS, Multibanco, MB WAY, Satispay)
и Alipay отключены.

Первая версия была сделана в евро и пересоздана в долларах: валюта в Stripe
привязана к цене и не переключается.

Редирект настроен через «...» → Edit → вкладка After payment → Redirect:

```
https://<адрес прода>/?checkout={CHECKOUT_SESSION_ID}
```

Фигурные скобки вводятся буквально — Stripe подставит идентификатор сам.

Адрес редиректа в Stripe редактируется позже, поэтому появившийся домен не
потребует пересоздавать ссылку.

Скопировать URL ссылки, тестовый ключ (`sk_test_...`) для ручной проверки пути
оплаты и боевой ключ (`sk_live_...`) для Railway. Ключи никуда не коммитить.

- [ ] **Step 5: Записать пороги успеха до запуска трафика**

Договориться с собственником и зафиксировать три числа с порогами, пока результата ещё нет:
1. доля дошедших до результата от открывших ссылку;
2. доля вернувшихся за вторым сканом;
3. стоимость одного платящего в евро.

Без этого шага любой исход теста можно будет истолковать как угодно.

---

## Task 1: Переменные окружения

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `getAccessPassConfig(environment?): AccessPassConfig | null`, где `AccessPassConfig = { stripeSecretKey: string; accessPassSecret: string; databaseUrl: string }`. Возвращает `null`, если хоть что-то не настроено — маршруты в задаче 8 на это отвечают 503.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `src/lib/env.test.ts`:

```ts
import { getAccessPassConfig } from "./env";

const completeAccessEnv = {
  STRIPE_SECRET_KEY: "sk_test_example",
  ACCESS_PASS_SECRET: "0123456789abcdef01",
  DATABASE_URL: "postgres://localhost:5432/sugar",
};

test("access pass config fails closed when anything is missing", () => {
  assert.deepEqual(getAccessPassConfig(completeAccessEnv), {
    stripeSecretKey: "sk_test_example",
    accessPassSecret: "0123456789abcdef01",
    databaseUrl: "postgres://localhost:5432/sugar",
  });
  assert.equal(getAccessPassConfig({ ...completeAccessEnv, STRIPE_SECRET_KEY: undefined }), null);
  assert.equal(getAccessPassConfig({ ...completeAccessEnv, DATABASE_URL: undefined }), null);
  // A short secret would weaken the email digest, so it is treated as absent.
  assert.equal(getAccessPassConfig({ ...completeAccessEnv, ACCESS_PASS_SECRET: "tooshort" }), null);
});
```

Импорт `getAccessPassConfig` добавить к существующей строке импорта из `./env`.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx tsx --test src/lib/env.test.ts`
Expected: FAIL — `getAccessPassConfig is not a function`.

- [ ] **Step 3: Расширить схему окружения**

В `src/lib/env.ts` добавить в `serverEnvSchema` после строки `RATE_LIMIT_SECRET: z.string().min(16).optional(),`:

```ts
  // Monetization test. Server-only: the secret key must never be inlined into
  // a browser bundle, so it is deliberately not a NEXT_PUBLIC_ variable.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  // Keys the buyer-email digest stored with an access pass. Rotating it makes
  // every existing pass unrestorable by email, so treat the value as durable
  // for the life of the test.
  ACCESS_PASS_SECRET: z.string().min(16).optional(),
```

- [ ] **Step 4: Добавить хелпер конфигурации**

В конец `src/lib/env.ts`:

```ts
export type AccessPassConfig = {
  stripeSecretKey: string;
  accessPassSecret: string;
  databaseUrl: string;
};

/**
 * The paid-access routes need three independent pieces of configuration. A
 * partially configured deployment must not half-work: it answers 503 rather
 * than issuing a pass it cannot store, or storing a digest under a weak key.
 */
export function getAccessPassConfig(environment: NodeJS.ProcessEnv = process.env): AccessPassConfig | null {
  const stripeSecretKey = environment.STRIPE_SECRET_KEY;
  const accessPassSecret = environment.ACCESS_PASS_SECRET;
  const databaseUrl = environment.DATABASE_URL;
  if (!stripeSecretKey) return null;
  if (!accessPassSecret || accessPassSecret.length < 16) return null;
  if (!databaseUrl) return null;
  return { stripeSecretKey, accessPassSecret, databaseUrl };
}
```

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

Run: `npx tsx --test src/lib/env.test.ts`
Expected: PASS

- [ ] **Step 6: Дописать `.env.example`**

В конец файла:

```sh
# --- Monetization test (paywall). Remove this whole block when the test ends. ---
# Build-time browser gate. While it is absent or false the scanner behaves
# exactly as before: no free-scan counter, no paywall, no access requests.
# NEXT_PUBLIC_PAYWALL_ENABLED=false
# Stripe Payment Link the paywall sends the buyer to. Its "after payment"
# redirect must point back at this app as /?checkout={CHECKOUT_SESSION_ID}.
# NEXT_PUBLIC_STRIPE_PAYMENT_LINK=
# Server-only Stripe secret key used to verify one completed checkout session.
# STRIPE_SECRET_KEY=
# Server-only HMAC key for the buyer-email digest stored with an access pass.
# At least 16 characters. Rotating it makes existing passes unrestorable.
# ACCESS_PASS_SECRET=
```

- [ ] **Step 7: Проверка типов и коммит**

Run: `npm run typecheck`
Expected: без ошибок.

```bash
git add src/lib/env.ts src/lib/env.test.ts .env.example
git commit -m "feat: add paid-access environment configuration"
```

---

## Task 2: Клиентский учёт бесплатных сканов

**Files:**
- Create: `src/lib/access/scan-entitlement.ts`
- Test: `src/lib/access/scan-entitlement.test.ts`

**Interfaces:**
- Produces: `FREE_SCAN_LIMIT`, `FREE_SCANS_KEY`, `ACCESS_PASS_KEY`, типы `EntitlementStorage`, `StoredAccessPass`, `Entitlement`, функции `readEntitlement(storage, now)`, `recordCompletedScan(storage, now)`, `storeAccessPass(storage, pass)`, `readActiveAccessPass(storage, now)`, `clearExpiredAccessPass(storage, now)`. Задача 9 вызывает их, передавая `window.localStorage` и `new Date()`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/lib/access/scan-entitlement.test.ts`:

```ts
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
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx tsx --test src/lib/access/scan-entitlement.test.ts`
Expected: FAIL — модуль `./scan-entitlement` не найден.

- [ ] **Step 3: Написать реализацию**

Создать `src/lib/access/scan-entitlement.ts`:

```ts
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
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx tsx --test src/lib/access/scan-entitlement.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Проверка типов и коммит**

Run: `npm run typecheck`
Expected: без ошибок.

```bash
git add src/lib/access/scan-entitlement.ts src/lib/access/scan-entitlement.test.ts
git commit -m "feat: track free scans and paid access in browser storage"
```

---

## Task 3: Хранилище пропусков доступа

**Files:**
- Create: `db/migrations/006_access_passes.sql`
- Create: `src/lib/access/access-pass.ts`
- Test: `src/lib/access/access-pass.test.ts`

**Interfaces:**
- Consumes: тип `SqlQueryExecutor` из `@/lib/catalog/repository` (уже экспортирован; `pg.Pool` ему структурно соответствует, как в `src/app/api/catalog/proposals/route.ts`).
- Produces: `ACCESS_WINDOW_DAYS`, тип `AccessPass = { token: string; expiresAt: string }`, функции `createAccessToken()`, `digestEmail(email, secret)`, `issueAccessPass(db, input)`, `findActivePassByEmail(db, input)`. Задача 8 вызывает две последние.

- [ ] **Step 1: Написать миграцию**

Создать `db/migrations/006_access_passes.sql`:

```sql
-- Paid access for the monetization test. This table holds no scan data, no
-- product data and no readable contact address: the buyer's email is stored
-- only as a keyed digest, which is enough to answer "does this address own an
-- active pass?" and nothing else. Dropping this table removes the whole
-- feature's stored state.
CREATE TABLE IF NOT EXISTS access_passes (
  token text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{48}$'),
  -- One payment yields exactly one pass, so reloading the Stripe success URL
  -- returns the existing pass instead of minting another.
  checkout_session_id text NOT NULL UNIQUE,
  email_digest text NOT NULL CHECK (email_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

-- Supports the restore-by-email lookup, newest active pass first.
CREATE INDEX IF NOT EXISTS access_passes_email_idx
  ON access_passes (email_digest, expires_at DESC);
```

- [ ] **Step 2: Написать падающий тест**

Создать `src/lib/access/access-pass.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_WINDOW_DAYS, createAccessToken, digestEmail, findActivePassByEmail, issueAccessPass } from "./access-pass";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const SECRET = "0123456789abcdef01";

type Call = { sql: string; parameters: readonly unknown[] };

function fakeDatabase(responses: Array<Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  const executor = {
    async query<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
      calls.push({ sql, parameters });
      return { rows: (responses.shift() ?? []) as Row[] };
    },
  };
  return { executor, calls };
}

test("an access token is 48 lowercase hex characters and unpredictable", () => {
  const first = createAccessToken();
  assert.match(first, /^[0-9a-f]{48}$/);
  assert.notEqual(first, createAccessToken());
});

test("email digests are stable, keyed, and case/whitespace insensitive", () => {
  const digest = digestEmail("Buyer@Example.com", SECRET);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, digestEmail("  buyer@example.com  ", SECRET));
  assert.notEqual(digest, digestEmail("buyer@example.com", "a-different-secret1"));
});

test("issuing a pass inserts idempotently and returns the stored row", async () => {
  const expiresAt = "2026-09-08T12:00:00.000Z";
  const { executor, calls } = fakeDatabase([[], [{ token: "b".repeat(48), expires_at: expiresAt }]]);
  const pass = await issueAccessPass(executor, {
    checkoutSessionId: "cs_test_123",
    email: "buyer@example.com",
    secret: SECRET,
    now: NOW,
  });
  assert.deepEqual(pass, { token: "b".repeat(48), expiresAt });
  assert.match(calls[0].sql, /ON CONFLICT \(checkout_session_id\) DO NOTHING/);
  // The readable address must never be a query parameter.
  assert.equal(calls[0].parameters.includes("buyer@example.com"), false);
  assert.equal(calls[0].parameters[2], digestEmail("buyer@example.com", SECRET));
  assert.equal(calls[0].parameters[4], new Date(NOW.getTime() + ACCESS_WINDOW_DAYS * 86_400_000).toISOString());
});

test("issuing a pass fails loudly when the row cannot be read back", async () => {
  const { executor } = fakeDatabase([[], []]);
  await assert.rejects(
    () => issueAccessPass(executor, { checkoutSessionId: "cs_test_123", email: "buyer@example.com", secret: SECRET, now: NOW }),
    /did not produce a row/,
  );
});

test("restore finds only an unexpired pass for that address", async () => {
  const { executor, calls } = fakeDatabase([[{ token: "c".repeat(48), expires_at: new Date("2026-09-05T00:00:00.000Z") }]]);
  const pass = await findActivePassByEmail(executor, { email: "buyer@example.com", secret: SECRET, now: NOW });
  assert.deepEqual(pass, { token: "c".repeat(48), expiresAt: "2026-09-05T00:00:00.000Z" });
  assert.match(calls[0].sql, /expires_at > \$2/);
  assert.equal(calls[0].parameters[1], NOW.toISOString());

  const empty = fakeDatabase([[]]);
  assert.equal(await findActivePassByEmail(empty.executor, { email: "nobody@example.com", secret: SECRET, now: NOW }), null);
});
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `npx tsx --test src/lib/access/access-pass.test.ts`
Expected: FAIL — модуль `./access-pass` не найден.

- [ ] **Step 4: Написать реализацию**

Создать `src/lib/access/access-pass.ts`:

```ts
import { createHmac, randomBytes } from "node:crypto";
import type { SqlQueryExecutor } from "@/lib/catalog/repository";

/** One payment buys this many days of unlimited scanning. */
export const ACCESS_WINDOW_DAYS = 7;

export type AccessPass = { token: string; expiresAt: string };

export function createAccessToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * The buyer's address is never stored in readable form. A keyed digest answers
 * the only question the restore flow asks — "does this address own an active
 * pass?" — while leaving nothing contactable in the database.
 */
export function digestEmail(email: string, secret: string): string {
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

type PassRow = { token: string; expires_at: string | Date };

function fromRow(row: PassRow): AccessPass {
  return { token: row.token, expiresAt: new Date(row.expires_at).toISOString() };
}

/**
 * Idempotent on the checkout session: a buyer who reloads the Stripe success
 * URL, or opens it on a second device, gets the same pass rather than a new
 * one per visit.
 */
export async function issueAccessPass(
  db: SqlQueryExecutor,
  input: { checkoutSessionId: string; email: string; secret: string; now: Date },
): Promise<AccessPass> {
  const expiresAt = new Date(input.now.getTime() + ACCESS_WINDOW_DAYS * 86_400_000);
  await db.query(
    `INSERT INTO access_passes (token, checkout_session_id, email_digest, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (checkout_session_id) DO NOTHING`,
    [
      createAccessToken(),
      input.checkoutSessionId,
      digestEmail(input.email, input.secret),
      input.now.toISOString(),
      expiresAt.toISOString(),
    ],
  );
  const { rows } = await db.query<PassRow>(
    `SELECT token, expires_at FROM access_passes WHERE checkout_session_id = $1`,
    [input.checkoutSessionId],
  );
  const row = rows[0];
  if (!row) throw new Error("Access pass insert did not produce a row.");
  return fromRow(row);
}

export async function findActivePassByEmail(
  db: SqlQueryExecutor,
  input: { email: string; secret: string; now: Date },
): Promise<AccessPass | null> {
  const { rows } = await db.query<PassRow>(
    `SELECT token, expires_at FROM access_passes
     WHERE email_digest = $1 AND expires_at > $2
     ORDER BY expires_at DESC LIMIT 1`,
    [digestEmail(input.email, input.secret), input.now.toISOString()],
  );
  const row = rows[0];
  return row ? fromRow(row) : null;
}
```

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

Run: `npx tsx --test src/lib/access/access-pass.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 6: Проверка типов и коммит**

Run: `npm run typecheck`
Expected: без ошибок.

```bash
git add db/migrations/006_access_passes.sql src/lib/access/access-pass.ts src/lib/access/access-pass.test.ts
git commit -m "feat: store paid access passes without a readable buyer address"
```

---

## Task 4: Проверка оплаты в Stripe

**Files:**
- Create: `src/lib/access/stripe-checkout.ts`
- Test: `src/lib/access/stripe-checkout.test.ts`

**Interfaces:**
- Produces: тип `CheckoutVerification` и функция `verifyCheckoutSession(sessionId, secretKey, fetchImpl?)`. Задача 8 вызывает её и отображает исходы на коды ответа: `paid` → 200, `unpaid` → 402, `invalid` → 400, `unavailable` → 503.

- [ ] **Step 1: Написать падающий тест**

Создать `src/lib/access/stripe-checkout.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { verifyCheckoutSession } from "./stripe-checkout";

const KEY = "sk_test_example";

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("a malformed session id never reaches Stripe", async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse({}));
  assert.deepEqual(await verifyCheckoutSession("../../admin", KEY, impl), { status: "invalid" });
  assert.deepEqual(await verifyCheckoutSession("", KEY, impl), { status: "invalid" });
  assert.deepEqual(calls, []);
});

test("a paid session returns the buyer address", async () => {
  const { impl, calls } = fakeFetch((url, init) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions/cs_test_abc123");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${KEY}`);
    return jsonResponse({ payment_status: "paid", customer_details: { email: "buyer@example.com" } });
  });
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, impl), {
    status: "paid",
    email: "buyer@example.com",
  });
  assert.equal(calls.length, 1);
});

test("an unpaid session is reported as unpaid", async () => {
  const { impl } = fakeFetch(() => jsonResponse({ payment_status: "unpaid", customer_details: { email: "buyer@example.com" } }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, impl), { status: "unpaid" });
});

test("an unknown session is invalid, and Stripe being down is not the buyer's fault", async () => {
  const missing = fakeFetch(() => new Response("", { status: 404 }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, missing.impl), { status: "invalid" });

  const broken = fakeFetch(() => new Response("", { status: 500 }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, broken.impl), { status: "unavailable" });

  const offline = fakeFetch(() => { throw new Error("network down"); });
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, offline.impl), { status: "unavailable" });

  // Paid but with no address to key a pass on: we cannot complete the flow,
  // and refusing the payment would be wrong, so this reads as a service fault.
  const noEmail = fakeFetch(() => jsonResponse({ payment_status: "paid", customer_details: {} }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, noEmail.impl), { status: "unavailable" });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx tsx --test src/lib/access/stripe-checkout.test.ts`
Expected: FAIL — модуль `./stripe-checkout` не найден.

- [ ] **Step 3: Написать реализацию**

Создать `src/lib/access/stripe-checkout.ts`:

```ts
/**
 * Verifies one completed Stripe Checkout session over the REST API.
 *
 * There is no Stripe SDK and no webhook endpoint on purpose. The buyer returns
 * from the Payment Link with a session id, we ask Stripe once whether that
 * session is paid, and that is the entire integration — which is what makes
 * this test feature removable in an afternoon.
 */
export type CheckoutVerification =
  | { status: "paid"; email: string }
  | { status: "unpaid" }
  | { status: "invalid" }
  | { status: "unavailable" };

/** Stripe checkout session ids. Validated before use so the id cannot walk the API path. */
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{8,80}$/;

export async function verifyCheckoutSession(
  sessionId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutVerification> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return { status: "invalid" };

  let response: Response;
  try {
    response = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${secretKey}` },
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 404) return { status: "invalid" };
  if (!response.ok) return { status: "unavailable" };

  const body = (await response.json().catch(() => null)) as
    | { payment_status?: unknown; customer_details?: { email?: unknown } | null }
    | null;
  if (!body) return { status: "unavailable" };
  if (body.payment_status !== "paid") return { status: "unpaid" };

  const email = body.customer_details?.email;
  // A paid session with no address cannot be turned into a restorable pass.
  // Reporting it as unpaid would blame the buyer for our configuration.
  if (typeof email !== "string" || email.length === 0) return { status: "unavailable" };
  return { status: "paid", email };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx tsx --test src/lib/access/stripe-checkout.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Проверка типов и коммит**

Run: `npm run typecheck`
Expected: без ошибок.

```bash
git add src/lib/access/stripe-checkout.ts src/lib/access/stripe-checkout.test.ts
git commit -m "feat: verify a completed Stripe checkout session"
```

---

## Task 5: События телеметрии для пейвола

**Files:**
- Modify: `src/lib/observability/result-metrics.ts`
- Modify: `src/app/api/scan/result-metrics/route.test.ts`
- Test: `src/lib/observability/result-metrics.test.ts`

**Interfaces:**
- Produces: три новых значения `action` в `resultMetricsSchema` — `paywall_shown`, `paywall_checkout_started`, `access_granted` (последнее с полем `grantSource: "checkout" | "restore"`). Задача 9 отправляет их на существующий `POST /api/scan/result-metrics`; менять маршрут не нужно.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `src/lib/observability/result-metrics.test.ts`:

```ts
test("paywall funnel events are accepted with no identifiers", () => {
  assert.equal(resultMetricsSchema.safeParse({ action: "paywall_shown" }).success, true);
  assert.equal(resultMetricsSchema.safeParse({ action: "paywall_checkout_started" }).success, true);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted", grantSource: "checkout" }).success, true);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted", grantSource: "restore" }).success, true);
});

test("paywall events reject unknown fields and free-form values", () => {
  // The buyer's address, a token, or a price must never become a log line.
  assert.equal(resultMetricsSchema.safeParse({ action: "paywall_shown", email: "buyer@example.com" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted", grantSource: "gift" }).success, false);
});
```

Если в файле ещё нет импорта `resultMetricsSchema`, добавить его в существующую строку импорта из `./result-metrics`.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx tsx --test src/lib/observability/result-metrics.test.ts`
Expected: FAIL — `paywall_shown` не проходит валидацию.

- [ ] **Step 3: Расширить контракт**

В `src/lib/observability/result-metrics.ts` добавить после `scanAbandonedSchema`:

```ts
/**
 * Monetization-test funnel. These three events answer "how many people saw the
 * wall, how many started paying, how many ended up with access" and nothing
 * else. `grantSource` separates a fresh purchase from a restore so the two are
 * not counted as the same thing. Remove this block when the test ends.
 */
const paywallShownSchema = z.object({ action: z.literal("paywall_shown") }).strict();

const paywallCheckoutStartedSchema = z.object({ action: z.literal("paywall_checkout_started") }).strict();

const accessGrantedSchema = z.object({
  action: z.literal("access_granted"),
  grantSource: z.enum(["checkout", "restore"]),
}).strict();
```

И добавить их в объединение:

```ts
export const resultMetricsSchema = z.discriminatedUnion("action", [
  scanStartedSchema,
  resultShownSchema,
  productOpenedSchema,
  recommendationOpenedSchema,
  scanRetriedSchema,
  scanAbandonedSchema,
  paywallShownSchema,
  paywallCheckoutStartedSchema,
  accessGrantedSchema,
]);
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npx tsx --test src/lib/observability/result-metrics.test.ts src/app/api/scan/result-metrics/route.test.ts`
Expected: PASS. Маршрут менять не потребовалось — он валидирует той же схемой.

- [ ] **Step 5: Проверка типов и коммит**

Run: `npm run typecheck`
Expected: без ошибок.

```bash
git add src/lib/observability/result-metrics.ts src/lib/observability/result-metrics.test.ts
git commit -m "feat: add paywall funnel events to the result metrics contract"
```

---

## Task 6: Экран пейвола

**Files:**
- Create: `src/app/paywall.tsx`
- Create: `src/app/paywall.module.css`

**Interfaces:**
- Produces: компонент по умолчанию `Paywall` и типы `PaywallProps`, `PaywallRestoreState`. Компонент чисто презентационный: он ничего не знает ни про Stripe, ни про хранилище, ни про телеметрию — всё это делает задача 9 через колбэки.

**Отступление от TDD, осознанное.** В репозитории нет ни одного теста React-компонента и нет средства для их запуска (`npm test` — это `tsx --test` по `src/**/*.test.ts`, без DOM). Ставить react-testing-library ради одноразовой фичи противоречит ограничению «никаких новых зависимостей». Проверка этой задачи — `npm run typecheck`, `npm run build` и просмотр глазами на шаге 4.

- [ ] **Step 1: Написать стили**

Создать `src/app/paywall.module.css`:

```css
/* Full-screen paid-access wall. It sits above the scanner the same way the
   onboarding story does, and uses the brand's dark ground with the coral
   accent so it does not read as a third-party payment interstitial. */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 24px 20px calc(28px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(10, 10, 12, 0.72) 0%, rgba(10, 10, 12, 0.97) 46%, #0a0a0c 100%);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  color: #f2f1f6;
}

.close {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  right: 16px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: rgba(242, 241, 246, 0.12);
  color: #f2f1f6;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.title {
  margin: 0 0 10px;
  font-size: 26px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.body {
  margin: 0 0 22px;
  font-size: 15px;
  line-height: 1.45;
  color: #cfccd8;
}

.checkout {
  width: 100%;
  padding: 17px 20px;
  border: 0;
  border-radius: 16px;
  background: #ff5a45;
  color: #ffffff;
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
}

.checkout:disabled {
  background: rgba(255, 90, 69, 0.4);
  cursor: default;
}

.fineprint {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.4;
  color: #a19cad;
  text-align: center;
}

.restoreToggle {
  display: block;
  width: 100%;
  margin-top: 18px;
  padding: 0;
  border: 0;
  background: none;
  color: #cfccd8;
  font-size: 14px;
  text-decoration: underline;
  cursor: pointer;
}

.restore {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.restore input {
  padding: 14px 16px;
  border: 1px solid rgba(242, 241, 246, 0.22);
  border-radius: 14px;
  background: rgba(242, 241, 246, 0.06);
  color: #f2f1f6;
  font-size: 16px;
}

.restore button {
  padding: 14px 16px;
  border: 1px solid rgba(242, 241, 246, 0.28);
  border-radius: 14px;
  background: none;
  color: #f2f1f6;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.restoreNote {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: #a19cad;
}

.restoreError {
  color: #ff7b68;
}
```

- [ ] **Step 2: Написать компонент**

Создать `src/app/paywall.tsx`:

```tsx
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
      <h1 className={styles.title}>You’ve used your free scans</h1>
      <p className={styles.body}>
        Unlimited scanning for 7 days. One payment of $2.99 — nothing renews and there is no subscription.
      </p>
      <button className={styles.checkout} type="button" disabled={!checkoutAvailable} onClick={onCheckout}>
        Get 7 days — $2.99
      </button>
      <p className={styles.fineprint}>
        {checkoutAvailable
          ? "This is a demo. Always check the package label before a dietary decision."
          : "Payments aren’t available right now. Please try again later."}
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
            <p className={`${styles.restoreNote} ${restoreState === "not_found" || restoreState === "error" ? styles.restoreError : ""}`}>
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
```

- [ ] **Step 3: Проверка типов и сборки**

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run build`
Expected: сборка проходит. Компонент пока никуда не подключён — это нормально, его подключает задача 9.

- [ ] **Step 4: Посмотреть глазами**

Компонент ещё не отрисовывается в приложении. Проверить его на этом шаге можно только чтением кода и сборкой; визуальная проверка на телефоне выполняется в задаче 9, где пейвол реально появляется на экране.

- [ ] **Step 5: Коммит**

```bash
git add src/app/paywall.tsx src/app/paywall.module.css
git commit -m "feat: add the paid-access paywall screen"
```

---

## Task 7: Иконки и установка на домашний экран

**Files:**
- Create: `public/icons/apple-touch-icon.png`, `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `public/manifest.webmanifest`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `design/reference/sugarno-app-icon-1024.png` — иконка приложения Sugar.no
  из App Store (разработчик Intendum Ltd, bundle `com.intend.sugarno`), уже лежит
  в репозитории.
- Produces: ничего для других задач.

**Зачем это в этом плане.** В `manifest.webmanifest` уже объявлен `display: standalone`, но иконок нет — установленный на экран сканер получил бы вместо иконки скриншот страницы. А установка на экран это единственный способ, которым iOS сохраняет разрешение на камеру между визитами, и именно её мы предлагаем человеку сразу после оплаты в задаче 9. Без иконок это предложение выглядит как поломка.

Иконка берётся настоящая, а не нарисованная: покупатель видит её в форме Stripe,
а потом ту же самую на домашнем экране. Две разные картинки в одном сценарии
читаются как ошибка.

Ресайз делается системным `sips` — он есть в каждой macOS, никаких зависимостей
в проект добавлять не нужно. Это одноразовая операция, результат коммитится.

- [ ] **Step 1: Нарезать три размера**

Run:

```bash
sips -s format png -z 180 180 design/reference/sugarno-app-icon-1024.png --out public/icons/apple-touch-icon.png
```

Run:

```bash
sips -s format png -z 192 192 design/reference/sugarno-app-icon-1024.png --out public/icons/icon-192.png
```

Run:

```bash
sips -s format png -z 512 512 design/reference/sugarno-app-icon-1024.png --out public/icons/icon-512.png
```

Каталог `public/icons/` создаётся `sips` сам, если его нет; если команда ругается на отсутствующий каталог — выполнить `mkdir -p public/icons` и повторить.

- [ ] **Step 2: Проверить результат**

Run: `file public/icons/*.png`
Expected: три строки вида `PNG image data, 180 x 180, 8-bit/color RGB, non-interlaced` — с размерами 180, 192 и 512 соответственно.

Открыть все три просмотрщиком и убедиться, что видна белая решётка с вилкой и ложкой на коралловом фоне, ничего не обрезано по краям.

- [ ] **Step 3: Прописать иконки в манифест**

Заменить содержимое `public/manifest.webmanifest`:

```json
{
  "name": "Sugar Shelf Scanner",
  "short_name": "Sugar Scanner",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0A0A0C",
  "theme_color": "#0A0A0C",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```

`purpose: "maskable"` намеренно не объявляется: у иконки нет запаса по краям под круговую обрезку Android, и объявленный maskable-вариант обрезал бы марку. Без объявления система добавит собственную подложку, что безопаснее.

- [ ] **Step 4: Прописать apple-теги в разметку**

В `src/app/layout.tsx` заменить объект `metadata`:

```ts
export const metadata: Metadata = {
  title: "Sugar Shelf Scanner",
  description: "Find the sugar score of products on a shelf.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Added to the Home Screen the origin becomes a standalone app, and iOS then
  // keeps the camera grant in system settings instead of re-asking every visit.
  appleWebApp: {
    capable: true,
    title: "Sugar Scanner",
    statusBarStyle: "black-translucent",
  },
};
```

- [ ] **Step 5: Проверить сборку и коммит**

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run build`
Expected: сборка проходит.

```bash
git add public/icons public/manifest.webmanifest src/app/layout.tsx design/reference/sugarno-app-icon-1024.png
git commit -m "feat: add installable app icons and apple web app metadata"
```

---

## Task 8: API-маршруты выдачи и восстановления доступа

**Files:**
- Create: `src/app/api/access/redeem/route.ts`
- Create: `src/app/api/access/restore/route.ts`
- Test: `src/app/api/access/redeem/route.test.ts`
- Test: `src/app/api/access/restore/route.test.ts`
- Modify: `src/lib/observability/scan-route.ts:5`

**Interfaces:**
- Consumes: `getAccessPassConfig` (задача 1), `issueAccessPass` / `findActivePassByEmail` (задача 3), `verifyCheckoutSession` (задача 4).
- Produces: `POST /api/access/redeem` с телом `{ checkoutSessionId: string }` и `POST /api/access/restore` с телом `{ email: string }`. Оба на успех отвечают `200 { token, expiresAt }`. Коды ошибок: 400 — тело или идентификатор не годятся, 402 — сессия не оплачена, 404 — активного доступа на эту почту нет, 429 — слишком часто, 503 — не настроено или Stripe/база недоступны. Задача 9 полагается ровно на эти коды.

**Границы тестирования, осознанные.** Маршруты ходят в Stripe и в PostgreSQL, а мокать `pg.Pool` и глобальный `fetch` в этом репозитории нечем. Поэтому тесты проверяют только защитные ветки, которые срабатывают до внешних вызовов: ненастроенное окружение и негодное тело запроса. Оплаченный путь целиком проверяется вручную на шаге 6.

- [ ] **Step 1: Расширить область действия ограничителя частоты**

В `src/lib/observability/scan-route.ts` заменить строку 5:

```ts
type ScanRoute = "preflight" | "analyze" | "recovery_label";
```

на:

```ts
// `access_restore` is an email-guessing surface, so it is rate limited by the
// same keyed digest as the scan routes. It never calls scanJsonResponse.
type ScanRoute = "preflight" | "analyze" | "recovery_label" | "access_restore";
```

- [ ] **Step 2: Написать падающие тесты**

Создать `src/app/api/access/redeem/route.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const ACCESS_KEYS = ["STRIPE_SECRET_KEY", "ACCESS_PASS_SECRET", "DATABASE_URL"] as const;

async function withoutAccessConfig(run: () => Promise<void>) {
  const previous = ACCESS_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ACCESS_KEYS) delete process.env[key];
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(body: unknown) {
  return new Request("http://localhost/api/access/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("redeem answers 503 while paid access is not configured", async () => {
  await withoutAccessConfig(async () => {
    const response = await POST(request({ checkoutSessionId: "cs_test_abc123" }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
});

test("redeem rejects a body that is not a checkout session id", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.ACCESS_PASS_SECRET = "0123456789abcdef01";
  process.env.DATABASE_URL = "postgres://localhost:5432/sugar";
  try {
    // A malformed id is refused before any Stripe call is attempted.
    assert.equal((await POST(request({ checkoutSessionId: "../admin" }))).status, 400);
    assert.equal((await POST(request({ token: "nope" }))).status, 400);
    assert.equal((await POST(request(null))).status, 400);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ACCESS_PASS_SECRET;
    delete process.env.DATABASE_URL;
  }
});
```

Создать `src/app/api/access/restore/route.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const ACCESS_KEYS = ["STRIPE_SECRET_KEY", "ACCESS_PASS_SECRET", "DATABASE_URL"] as const;

function request(body: unknown) {
  return new Request("http://localhost/api/access/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("restore answers 503 while paid access is not configured", async () => {
  const previous = ACCESS_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ACCESS_KEYS) delete process.env[key];
  try {
    const response = await POST(request({ email: "buyer@example.com" }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("restore rejects a body that is not an email address", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.ACCESS_PASS_SECRET = "0123456789abcdef01";
  process.env.DATABASE_URL = "postgres://localhost:5432/sugar";
  try {
    assert.equal((await POST(request({ email: "not-an-address" }))).status, 400);
    assert.equal((await POST(request({}))).status, 400);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ACCESS_PASS_SECRET;
    delete process.env.DATABASE_URL;
  }
});
```

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `npx tsx --test src/app/api/access/redeem/route.test.ts src/app/api/access/restore/route.test.ts`
Expected: FAIL — модули `./route` не найдены.

- [ ] **Step 4: Написать маршрут выдачи**

Создать `src/app/api/access/redeem/route.ts`:

```ts
import { Pool } from "pg";
import { z } from "zod";
import { issueAccessPass } from "@/lib/access/access-pass";
import { verifyCheckoutSession } from "@/lib/access/stripe-checkout";
import { getAccessPassConfig } from "@/lib/env";

export const runtime = "nodejs";

const bodySchema = z.object({ checkoutSessionId: z.string().min(1).max(120) }).strict();

const accessPool = globalThis as typeof globalThis & { __sugarAccessPool?: Pool };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Exchanges a completed Stripe checkout session for an access pass.
 *
 * There is no webhook: the buyer's return from the Payment Link is the trigger,
 * and Stripe itself is asked whether that session was actually paid. Issuing is
 * idempotent, so reloading the success URL returns the same pass.
 */
export async function POST(request: Request) {
  const config = getAccessPassConfig();
  if (!config) return json({ error: "unavailable" }, 503);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const verification = await verifyCheckoutSession(parsed.data.checkoutSessionId, config.stripeSecretKey);
  if (verification.status === "invalid") return json({ error: "invalid_request" }, 400);
  if (verification.status === "unavailable") return json({ error: "unavailable" }, 503);
  if (verification.status === "unpaid") return json({ error: "not_paid" }, 402);

  const pool = (accessPool.__sugarAccessPool ??= new Pool({ connectionString: config.databaseUrl }));
  try {
    const pass = await issueAccessPass(pool, {
      checkoutSessionId: parsed.data.checkoutSessionId,
      email: verification.email,
      secret: config.accessPassSecret,
      now: new Date(),
    });
    return json(pass, 200);
  } catch {
    // The payment succeeded even though we could not store the pass. Say
    // nothing about the database; the buyer can restore by email once it is up.
    return json({ error: "unavailable" }, 503);
  }
}
```

- [ ] **Step 5: Написать маршрут восстановления**

Создать `src/app/api/access/restore/route.ts`:

```ts
import { Pool } from "pg";
import { z } from "zod";
import { findActivePassByEmail } from "@/lib/access/access-pass";
import { getAccessPassConfig } from "@/lib/env";
import { checkScanRateLimit } from "@/lib/observability/scan-route";

export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().email().max(254) }).strict();

const accessPool = globalThis as typeof globalThis & { __sugarAccessPool?: Pool };

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Returns an active pass for the address the buyer paid with.
 *
 * This is what makes a purchase survive the browser it was made in — an ad
 * click opens in the Instagram in-app browser, whose storage is isolated from
 * Safari. It is rate limited because it is the one endpoint where guessing an
 * address would gain anything.
 */
export async function POST(request: Request) {
  const config = getAccessPassConfig();
  if (!config) return json({ error: "unavailable" }, 503);

  const rateLimit = checkScanRateLimit(request, {
    scope: "access_restore",
    limit: 10,
    windowMs: 60_000,
    secret: process.env.RATE_LIMIT_SECRET,
  });
  if (!rateLimit.allowed) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": String(rateLimit.retryAfterSeconds) });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const pool = (accessPool.__sugarAccessPool ??= new Pool({ connectionString: config.databaseUrl }));
  try {
    const pass = await findActivePassByEmail(pool, {
      email: parsed.data.email,
      secret: config.accessPassSecret,
      now: new Date(),
    });
    if (!pass) return json({ error: "not_found" }, 404);
    return json(pass, 200);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
```

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `npx tsx --test src/app/api/access/redeem/route.test.ts src/app/api/access/restore/route.test.ts`
Expected: PASS, 4 теста.

Run: `npm test`
Expected: весь набор проходит.

- [ ] **Step 7: Применить миграцию и проверить путь оплаты вручную**

Применить миграцию задачи 3 к базе Railway:

```bash
psql "$DATABASE_URL" -f db/migrations/006_access_passes.sql
```

Задать в `.env.local` `STRIPE_SECRET_KEY` (тестовый ключ `sk_test_...`), `ACCESS_PASS_SECRET`, `DATABASE_URL`, запустить `npm run dev` и пройти тестовую оплату по тестовой ссылке Stripe с картой `4242 4242 4242 4242`. Ожидаемое: возврат на `/?checkout=cs_test_...`, в таблице появляется ровно одна строка, повторный запрос с тем же `checkoutSessionId` возвращает тот же `token`.

- [ ] **Step 8: Проверка типов и коммит**

Run: `npm run typecheck`
Expected: без ошибок.

```bash
git add src/app/api/access src/lib/observability/scan-route.ts
git commit -m "feat: issue and restore paid access passes"
```

---

## Task 9: Подключение пейвола в сканер

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `Paywall` и `PaywallRestoreState` (задача 6); `readEntitlement`, `recordCompletedScan`, `storeAccessPass`, `clearExpiredAccessPass`, `FREE_SCAN_LIMIT`, тип `Entitlement` (задача 2); маршруты `/api/access/redeem` и `/api/access/restore` (задача 8); события `paywall_shown`, `paywall_checkout_started`, `access_granted` (задача 5).
- Produces: ничего для других задач.

Это единственная задача, которая правит `src/app/page.tsx`. Её нельзя выполнять параллельно ни с чем.

- [ ] **Step 1: Добавить импорты, константы и помощник хранилища**

После строки `import OnboardingStory from "./onboarding-story";`:

```ts
import Paywall, { type PaywallRestoreState } from "./paywall";
import {
  FREE_SCAN_LIMIT,
  clearExpiredAccessPass,
  readEntitlement,
  recordCompletedScan,
  storeAccessPass,
  type Entitlement,
} from "@/lib/access/scan-entitlement";
```

Рядом с `const clientScannerMetricsEnabled = …` (строка 64) добавить:

```ts
// Monetization test. While this is not "true" nothing below changes behaviour:
// no free-scan counter, no wall, no access requests.
const paywallEnabled = process.env.NEXT_PUBLIC_PAYWALL_ENABLED === "true";
const checkoutUrl = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ?? "";
```

Рядом с другими модульными помощниками (перед `export default function HomePage()`):

```ts
/** Blocked site data throws on access, so every caller takes null instead. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function accessGrantedCopy(expiresAt: string): string {
  const until = new Date(expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  return `You’re in — unlimited scans until ${until}. Add this page to your Home Screen so the camera stays allowed between visits.`;
}
```

- [ ] **Step 2: Добавить состояние**

После строки `const [deferAutoResults, setDeferAutoResults] = useState(false);`:

```ts
  const [entitlement, setEntitlement] = useState<Entitlement>({ paid: false, freeScansUsed: 0, freeScansRemaining: FREE_SCAN_LIMIT, mustPay: false });
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [restoreState, setRestoreState] = useState<PaywallRestoreState>("idle");
  const [accessBanner, setAccessBanner] = useState<string | null>(null);
```

- [ ] **Step 3: Прочитать состояние доступа и обменять возврат из Stripe**

Сразу после эффекта, читающего `ONBOARDING_SEEN_KEY`, добавить:

```ts
  // The Payment Link returns the buyer here with a checkout session id. It is
  // exchanged once for a pass and then stripped from the address, so a shared
  // or reloaded URL can never look like a second purchase.
  useEffect(() => {
    if (!paywallEnabled) return;
    clearExpiredAccessPass(browserStorage(), new Date());
    const checkoutSessionId = new URLSearchParams(window.location.search).get("checkout");
    if (!checkoutSessionId) {
      setEntitlement(readEntitlement(browserStorage(), new Date()));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/access/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ checkoutSessionId }),
        });
        if (cancelled || !response.ok) return;
        const pass = await response.json() as { token: string; expiresAt: string };
        storeAccessPass(browserStorage(), pass);
        reportResultMetric(clientScannerMetricsEnabled, { action: "access_granted", grantSource: "checkout" });
        setAccessBanner(accessGrantedCopy(pass.expiresAt));
        setPaywallOpen(false);
      } catch {
        // A failed exchange is recoverable: the buyer can restore by email.
      } finally {
        if (!cancelled) {
          const url = new URL(window.location.href);
          url.searchParams.delete("checkout");
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
          setEntitlement(readEntitlement(browserStorage(), new Date()));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);
```

Если `reportResultMetric` ещё не импортирован в `page.tsx`, добавить его к существующему импорту из `@/lib/scan/result-metrics`.

- [ ] **Step 4: Добавить обработчики оплаты и восстановления**

Перед объявлением `const start = useCallback(async () => {`:

```ts
  const openPaywall = useCallback(() => {
    setRestoreState("idle");
    setPaywallOpen(true);
    reportResultMetric(clientScannerMetricsEnabled, { action: "paywall_shown" });
  }, []);

  const startCheckout = useCallback(() => {
    if (!checkoutUrl) return;
    reportResultMetric(clientScannerMetricsEnabled, { action: "paywall_checkout_started" });
    // Same tab on purpose: a new window inside an in-app browser from an ad
    // has no reliable way back to this page.
    window.location.assign(checkoutUrl);
  }, []);

  const restoreAccess = useCallback(async (email: string) => {
    setRestoreState("working");
    try {
      const response = await fetch("/api/access/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        setRestoreState(response.status === 404 ? "not_found" : "error");
        return;
      }
      const pass = await response.json() as { token: string; expiresAt: string };
      storeAccessPass(browserStorage(), pass);
      reportResultMetric(clientScannerMetricsEnabled, { action: "access_granted", grantSource: "restore" });
      setEntitlement(readEntitlement(browserStorage(), new Date()));
      setAccessBanner(accessGrantedCopy(pass.expiresAt));
      setRestoreState("idle");
      setPaywallOpen(false);
    } catch {
      setRestoreState("error");
    }
  }, []);
```

- [ ] **Step 5: Поставить ворота перед обоими путями скана**

Первой строкой внутри `const start = useCallback(async () => {`:

```ts
    if (paywallEnabled && readEntitlement(browserStorage(), new Date()).mustPay) { openPaywall(); return; }
```

Добавить `openPaywall` в массив зависимостей `start`: `}, [clearResult, openPaywall, resetScanMetrics, sampleLiveFrame, stopStream]);`

В `function upload(file: File | undefined)` сразу после `if (!file || uploadBusy) return;`:

```ts
    if (paywallEnabled && readEntitlement(browserStorage(), new Date()).mustPay) { openPaywall(); return; }
```

- [ ] **Step 6: Списывать бесплатный скан только за состоявшийся результат**

В `analyze`, в строке обработки успешного ответа, заменить:

```ts
      if (result.detections.some(eligible)) { setScan(result); dispatch("ANALYZE_SUCCESS"); } else { reportNoDetectionResult(); setFailure("No recognizable packaged products found"); dispatch("NO_SCENE"); }
```

на:

```ts
      if (result.detections.some(eligible)) {
        setScan(result);
        dispatch("ANALYZE_SUCCESS");
        // Only a scan that produced a result consumes the allowance: a failed
        // or empty scan is our problem, and charging for it would also make
        // the funnel numbers stop meaning what they say.
        if (paywallEnabled) setEntitlement(recordCompletedScan(browserStorage(), new Date()));
      } else { reportNoDetectionResult(); setFailure("No recognizable packaged products found"); dispatch("NO_SCENE"); }
```

- [ ] **Step 7: Отрисовать пейвол и подтверждение доступа**

В `return <>…` добавить сразу после элемента `OnboardingStory`:

```tsx
{paywallEnabled && paywallOpen && !recoveryActive && <Paywall checkoutAvailable={checkoutUrl.length > 0} restoreState={restoreState} onCheckout={startCheckout} onRestore={(email) => void restoreAccess(email)} onClose={() => setPaywallOpen(false)} />}
```

После элемента `{state === "camera_off" && <ScannerHome … />}` добавить:

```tsx
{accessBanner && state === "camera_off" ? <p className="access-granted-banner" role="status">{accessBanner}</p> : null}
```

В конец `src/app/globals.css`:

```css
/* Monetization test: the payoff moment right after access is granted. The
   Home Screen ask is here because an installed origin is the only way iOS
   keeps the camera grant between visits. */
.access-granted-banner {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: calc(120px + env(safe-area-inset-bottom));
  z-index: 5;
  margin: 0;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 90, 69, 0.16);
  color: #f2f1f6;
  font-size: 14px;
  line-height: 1.4;
  text-align: center;
}
```

Переменная `entitlement` в интерфейсе намеренно не показывается: счётчик «осталось 2 скана» превращает пробу в экономию, а нам для теста нужно ровно обратное — чтобы человек сканировал столько, сколько ему хочется, и мы увидели настоящую цифру.

- [ ] **Step 8: Проверить, что при выключенном флаге ничего не изменилось**

Run: `npm test`
Expected: весь набор проходит.

Run: `npm run verify`
Expected: чистая сборка и проверка типов без ошибок.

Запустить `npm run dev` без `NEXT_PUBLIC_PAYWALL_ENABLED`, открыть `http://localhost:3000`, пройти онбординг и нажать Start. Ожидаемое: сканер ведёт себя ровно как раньше, никакого пейвола, в сетевой панели нет запросов к `/api/access/*`.

- [ ] **Step 9: Проверить пейвол глазами**

Остановить дев-сервер, добавить в `.env.local`:

```sh
NEXT_PUBLIC_PAYWALL_ENABLED=true
NEXT_PUBLIC_STRIPE_PAYMENT_LINK=https://buy.stripe.com/test_your_link
```

Запустить `npm run dev` заново (переменная сборочная, перезапуск обязателен), открыть страницу, в консоли браузера выполнить:

```js
localStorage.setItem("sugar:free-scans:v1", "3")
```

Перезагрузить страницу и нажать Start.

Ожидаемое: камера не запрашивается, поверх экрана появляется пейвол с заголовком «You've used your free scans» и кнопкой «Get 7 days — $2.99». Кнопка «Already paid on another browser?» раскрывает поле почты. Кнопка Gallery тоже ведёт на пейвол, а не на выбор файла. Сделать скриншот и приложить к задаче.

- [ ] **Step 10: Коммит**

```bash
git add src/app/page.tsx src/app/globals.css
git commit -m "feat: gate scanning behind the free allowance and paid access"
```

---

## Task 10: Документация

**Files:**
- Create: `docs/monetization-test.md`
- Modify: `docs/product-ux.md`
- Modify: `docs/operations.md`
- Modify: `docs/README.md`

**Interfaces:**
- Produces: строку в карте документов и описанный порядок включения, отключения и сноса фичи.

- [ ] **Step 1: Написать документ теста монетизации**

Создать `docs/monetization-test.md` со следующими разделами (содержание заполняется фактами из задачи 0 и решениями этого плана):

- **Что проверяем.** Гипотеза принадлежит собственнику: нужен ли сканер полки пользователю и монетизируется ли он. Тест не может выйти в плюс на платном трафике — разовая продажа $2.99 не отбивает клик из Meta ни при каких реалистичных вводных. Тест покупает три числа, а не выручку.
- **Три метрики и пороги**, зафиксированные до запуска (шаг 5 задачи 0).
- **Устройство доступа.** Три бесплатных скана в `localStorage`; лимит намеренно сбрасывается при смене браузера, потому что скан стоит доли цента. Платный доступ — на 7 дней, хранится на сервере, восстанавливается по почте покупателя в любом браузере.
- **Известные искажения.** Внутри встроенного браузера Instagram, скорее всего,
  нет Apple Pay, поэтому конверсия оплаты — нижняя граница.
- **Каталог не покрывает американскую полку, и это надо сказать собственнику
  заранее.** В проверенном каталоге 19 товаров, все — напитки, и все в
  европейской банке 330 мл. Совпадение по размеру упаковки в
  `scoreCatalogMatch` жёсткое: другой размер отклоняет подтверждение целиком.
  Американская банка — 12 fl oz (355 мл), поэтому на американском трафике
  результаты будут почти всегда `estimate_only`, а не `confirmed`. Продукт при
  этом работает: Gemini распознаёт упаковку и оценивает сахар. Но если ждать
  «подтверждённых данных», результат теста прочитается как сырость продукта, а
  не как отсутствие американского каталога. Завести ~20 американских SKU — это
  работа куратора, а не разработки, и для проверки гипотезы не обязательна.
- **Что считается ответом собственнику.** Стоимость платящего против цены пакета и вытекающая развилка: подписка, ведение в приложение Sugar.no или другой канал трафика.

- [ ] **Step 2: Дописать раздел в product-ux.md**

Добавить после раздела «First visit»:

```markdown
## Paid access (monetization test)

The scanner allows three completed scans per browser, then shows a wall
offering seven days of unlimited scanning for a single $2.99 payment. Only a
scan that produced a result consumes the allowance: a failed or empty scan is
not the user's fault and must not be charged for.

The allowance lives in `localStorage` under `sugar:free-scans:v1` and resets
when the user switches browsers or clears site data. That is deliberate — a
scan costs a fraction of a cent, and server-side identity would cost more in
conversion than the tokens it saves, while conflicting with the no-identifier
telemetry contract.

A purchase behaves differently. It is stored server-side, keyed to a digest of
the buyer's email, and restorable from any browser through **Already paid on
another browser?** on the wall. This exists because an ad click opens in the
Instagram in-app browser, whose storage is isolated from Safari: without a
restore path a buyer who reopens the link elsewhere would lose what they paid
for.

The remaining free count is never shown. A visible counter turns a trial into
rationing, and the test needs the opposite — people scanning as much as they
actually want to.

The whole feature is off unless the build carries
`NEXT_PUBLIC_PAYWALL_ENABLED=true`. See
[monetization-test.md](monetization-test.md).
```

- [ ] **Step 3: Дописать раздел в operations.md**

Добавить перед разделом «Privacy-safe scanner telemetry»:

```markdown
## Paid access (monetization test)

Required before enabling: migration `006_access_passes.sql` applied and a Stripe
Payment Link whose after-payment redirect is
`https://<production address>/?checkout={CHECKOUT_SESSION_ID}`.

The test deliberately runs on the existing Railway address with no custom
domain. Card details are entered on `checkout.stripe.com`, not here, so the
address never sits under a payment form. The one thing it could affect is Meta
ad review, which rejects raw hosting subdomains more often than ordinary
domains; if that happens, add the domain before spending on traffic rather than
mid-test. The free allowance and passes are per-origin, so a domain move resets
every counter. Paid access survives it — a pass restores by the buyer's email.

Railway variables: `STRIPE_SECRET_KEY` and `ACCESS_PASS_SECRET` are server-only
and must never be given a `NEXT_PUBLIC_` name. `NEXT_PUBLIC_PAYWALL_ENABLED`
and `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` are build-time, so redeploy after
changing them. `ACCESS_PASS_SECRET` is durable: rotating it makes every
existing pass unrestorable by email.

There is no webhook and no Stripe SDK. `POST /api/access/redeem` asks Stripe
once whether the returned session was paid and issues the pass; issuing is
idempotent per checkout session. `POST /api/access/restore` returns an active
pass for the address the buyer paid with and is rate limited.

Refunds are issued in the Stripe dashboard on first request without argument.
A demo that fails to find a product has already cost the buyer their goodwill;
a chargeback and a public review cost more than $2.99.

To turn the test off: set `NEXT_PUBLIC_PAYWALL_ENABLED=false` and redeploy —
the scanner returns to unlimited free scanning immediately, and existing passes
simply stop mattering. To remove it entirely: delete `src/lib/access/`,
`src/app/api/access/`, `src/app/paywall.tsx`, `src/app/paywall.module.css`,
their call sites in `src/app/page.tsx`, and drop the `access_passes` table.
```

- [ ] **Step 4: Дописать карту документов**

В `docs/README.md` добавить в таблицу перед строкой про операции:

```markdown
| Paywall hypothesis, success thresholds and access mechanics | [monetization-test.md](monetization-test.md) |
```

- [ ] **Step 5: Коммит**

```bash
git add docs/monetization-test.md docs/product-ux.md docs/operations.md docs/README.md
git commit -m "docs: record the paywall monetization test and its operations"
```

---

## Гейт перед выкаткой

Перед пушем в `main` (порядок из [operations.md](../../operations.md)):

1. `git fetch` — в `main` пушет не только Александра.
2. `npm test`
3. `npm run verify`
4. `git diff --check`
5. Проверка приватности: в `access_passes` нет открытой почты; в stdout нет ни токенов, ни адресов, ни цен — только три разрешённых события.
6. Ручной проход на iPhone: Start → результат → Details, затем три скана до пейвола, оплата тестовой картой, возврат, восстановление по почте во втором браузере.

Первую выкатку делать с `NEXT_PUBLIC_PAYWALL_ENABLED=false`: код уезжает на прод, поведение не меняется, и включение остаётся отдельным обратимым шагом.

## Что этот план сознательно не делает

- **Не защищает бесплатный лимит от обхода.** Скан стоит доли цента; крепость вокруг этой суммы не окупается и стоит конверсии.
- **Не проверяет доступ на сервере при скане.** `/api/scan/analyze` не знает про пропуска. Подделка флага в `localStorage` возможна и допустима — это цена в центах против недели работы.
- **Не шлёт писем.** Почтовый провайдер — это ещё один аккаунт, домен для подписи и согласие на рассылку в ЕС. Восстановление по адресу, которым платили, даёт тот же результат для пользователя без всего этого.
- **Не делает сплит-тест цены.** Чтобы отличить $1.99 от $3.99, нужно под сотню оплат на вариант; при ожидаемых объёмах получится красивая таблица и ноль знания. Вместо этого меряются два шага отдельно: нажал «купить» и дошёл до оплаты.
- **Не ведёт в приложение Sugar.no.** Этой фичи там пока нет — решение Александры от 31.08.2026.
