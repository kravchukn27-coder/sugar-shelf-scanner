# Monetization test

This document is the record of what the paywall test checks, why it is built
the way it is, and what the numbers can and cannot tell the business owner.
For the interface behaviour see
[product-ux.md](product-ux.md#paid-access-monetization-test); for enabling,
disabling and removing it see
[operations.md](operations.md#paid-access-monetization-test).

## What we are testing

The hypothesis belongs to the product owner: does anyone actually want the
shelf scanner, and will they pay for it. The test cannot come out ahead on
paid traffic — a single $2.99 sale does not cover the cost of a Meta ad click
under any realistic assumption, and it is not meant to. This test buys three
numbers, not revenue.

## Three metrics and their thresholds

Each metric is defined precisely below: what it counts, and from which event
to which event. **The pass/fail number for each one does not exist yet.**

> **⚠️ PLACEHOLDER — NOT YET AGREED. DO NOT READ ANY NUMBER BELOW AS DECIDED.**
>
> The three thresholds are an open manual step (Task 0, Step 5): the product
> owner has not yet agreed them with the business owner. Until a specific
> number is written into this document, in this section, replacing this
> placeholder, **no traffic may be sent to this test.** A threshold fixed
> after the results are already in can be read to justify any conclusion —
> that is the one failure mode this test cannot recover from after the fact.
> Whoever agrees the numbers should edit this file directly and remove this
> warning.

1. **Wall-to-purchase conversion.**
   The ratio of two aggregate event counts over the test period: the count of
   `access_granted` events with `grantSource: "checkout"` divided by the count
   of `paywall_shown` events. This is "shown the wall, ended up with paid
   access via a fresh purchase" — it does not include restores, which are a
   different browser recovering access it already paid for elsewhere.
   This is an event ratio, not a per-person rate. `paywall_shown` and
   `access_granted` carry no session id, browser id, or any other
   identifier — the telemetry contract forbids one by design (see
   `src/lib/observability/result-metrics.ts`) — so nothing links one event to
   another, and no per-browser or per-person figure can ever be computed from
   this data. The ratio is also biased low: `paywall_shown` fires on every
   press of Start once the free allowance is exhausted (see `openPaywall` in
   `src/app/page.tsx`), not once per person, so one undecided visitor who taps
   Start five times contributes five to the denominator and none to the
   numerator. The measured number is a **floor** on the true per-person
   conversion, not an estimate of it, and by an unknown factor that depends on
   how much people hesitate. The threshold agreed with the business owner
   must be a threshold on this event ratio — the quantity that will actually
   exist — not on an imagined per-person conversion rate.
   - **Threshold: `[AGREE BEFORE LAUNCH — NOT SET]`**

2. **Wall-to-checkout-start conversion.**
   The ratio of two aggregate event counts over the test period: the count of
   `paywall_checkout_started` events divided by the count of `paywall_shown`
   events. This isolates "clicked buy" from "finished paying," so a gap
   between this metric and the one above points at the Stripe checkout step
   itself rather than at the wall's copy or price.
   As with metric 1, this is an event ratio, not a per-person rate — the
   funnel events carry no identifier of any kind, by design, so no per-browser
   or per-person figure can be computed. The same bias applies in the same
   direction: `paywall_shown` fires on every Start press, not once per
   person, so repeated presses from undecided visitors inflate the
   denominator and the measured number is a floor on the true per-person
   rate. The threshold agreed with the business owner must be set on this
   event ratio, not on an imagined per-person rate.
   - **Threshold: `[AGREE BEFORE LAUNCH — NOT SET]`**

3. **Cost per payer, in US dollars.**
   Ad spend for the test period divided by the count of distinct
   `access_granted` events with `grantSource: "checkout"` in that period. This
   is a cost figure, not a profit figure: it is compared against the $2.99
   price to size the gap, not to claim the test broke even. Currency is
   US dollars throughout — the product's market is the United States, and no
   euro figure belongs in this test or its reporting.
   - **Threshold: `[AGREE BEFORE LAUNCH — NOT SET]`**

## Access mechanics

Three completed scans are free per browser. Only a scan that produced a
result consumes one of the three — a failed or empty scan is not the user's
fault and is not charged. The count lives in `localStorage` under
`sugar:free-scans:v1` and is never shown in the interface; a visible counter
turns a free trial into rationing, and the test wants people scanning as much
as they actually would.

The limit resets whenever the browser or site data changes. This is
deliberate, not an oversight: a scan costs a fraction of a cent, so building
resistance against a browser-storage reset is not worth what it would cost in
conversion friction, and it would also require exactly the kind of per-user
identifier the scanner's telemetry contract is built to avoid.

Paid access is the opposite case. A single $2.99 payment unlocks seven days
of unlimited scanning. The pass is issued server-side and stored in the
`access_passes` table keyed by an HMAC digest of the buyer's email — the
address itself is never stored in readable form. From any browser, "Already
paid on another browser?" on the wall lets the buyer restore that pass by
entering the same email. This exists because a Meta ad opens inside
Instagram's in-app browser, whose storage is isolated from the buyer's actual
browser (e.g. Safari); without a restore path, a buyer who taps the ad again
later or opens the link in a different app would appear to have lost what
they paid for.

There is no subscription and nothing renews. The pass simply stops working
after seven days, and buying again starts a new one.

## Known distortions

**Instagram's in-app browser likely has no Apple Pay.** Payment happens on
`checkout.stripe.com`, opened from inside Instagram's built-in browser when
the user taps the ad. That embedded browser is commonly missing Apple Pay
even when the user's actual Safari has it configured, because Apple Pay
depends on browser integration that in-app browsers do not always provide.
Anyone who would have paid with one tap in Safari may abandon at checkout
instead. Read the checkout-conversion metric as a **floor**, not as the true
number: real-world conversion in a full browser is likely to be higher.

## The catalog does not cover the American shelf, and the owner should know before launch

The reviewed catalog behind "Confirmed" results has 19 products, all
beverages, all in the European 330 ml can. Pack-size matching inside the
catalog resolver is strict by design: a different pack size rejects a
confirmed match outright rather than confirming the wrong nutrition figures
for a similar-looking product. The standard American can is 12 fl oz
(355 ml) — a different size from every catalog entry.

The practical consequence: on American traffic, almost every result will land
as `estimate_only` rather than `confirmed`, even though the scanner is
working correctly. Gemini still recognizes the packaging and produces a sugar
estimate; there is simply no matching US SKU to confirm it against. If this
is not said plainly ahead of time, a test that shows mostly estimates instead
of confirmations will read as evidence the product itself is unreliable, when
what it actually reflects is the absence of a US catalog. Building out
roughly 20 American SKUs is curator work, not engineering work, and is not a
prerequisite for running this test — it is a prerequisite for reading
"confirmed vs. estimate" as a quality signal on US traffic, which this test
does not need.

## What counts as an answer to the business owner

The report back to the business owner is: cost per payer against the $2.99
price, alongside the two conversion numbers above, read against whatever
thresholds get agreed before launch. The outcome is a fork, not a verdict:

- Numbers clearly beating the thresholds → the shelf scanner is worth
  building into a real paid product, and the next question is what that
  product looks like (a subscription instead of a one-time pass being the
  most obvious candidate, since a single $2.99 sale is structurally
  incapable of profitability against ad spend).
- Numbers clearly missing the thresholds → either the audience is wrong (try
  a different traffic channel or a different landing message) or the product
  is wrong (folding the scanner into the existing Sugar.no app as a feature
  rather than a standalone paid product, rather than continuing to buy cold
  traffic for it).
- Numbers in between → the test has not bought a clean answer, and the
  honest move is to say so rather than round to whichever conclusion is more
  convenient.

This test intentionally does not try to distinguish this from a price
change, a subscription model, or a different channel. It answers one
question — is there enough demand and willingness to pay to justify going
further — and the fork above is what "further" means depending on the
answer.
