import fs from "node:fs/promises";

const ROOT = "outputs/threshold-benchmark-2026-08-27";

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split("\n");
  const headers = headerLine.split(",");
  return lines.map((line) => {
    // Simple CSV split good enough for this manifest (no embedded commas in quoted fields beyond product/notes which we keep comma-free here except a couple; guard with a tiny quoted-field parser).
    const cells = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

const manifest = parseCsv(await fs.readFile(`${ROOT}/manifest.csv`, "utf8"));
const raw = JSON.parse(await fs.readFile(`${ROOT}/raw_results.json`, "utf8"));
const rawByPhoto = new Map(raw.map((r) => [r.photo, r]));

const PREFLIGHT_THRESHOLDS = [0.55, 0.60, 0.65, 0.70, 0.75, 0.80];
const RESOLVER_THRESHOLDS = [0.80, 0.85, 0.90, 0.95];

console.log("=== PREFLIGHT: raw Gemini decision/confidence vs ground truth ===\n");
console.log("photo | truth      | gemini_decision | confidence | count");
for (const m of manifest) {
  const r = rawByPhoto.get(m.photo);
  const pf = r?.preflight;
  if (!pf || "error" in pf) { console.log(`${m.photo}  | ${m.preflight_truth.padEnd(10)} | ERROR`); continue; }
  console.log(`${m.photo}  | ${m.preflight_truth.padEnd(10)} | ${pf.decision.padEnd(15)} | ${pf.confidence.toFixed(2)}       | ${pf.packagedProductCount}`);
}

console.log("\n=== PREFLIGHT threshold sweep ===");
console.log("A photo 'passes' preflight iff gemini decision==candidate AND count>=1 AND confidence>=threshold.");
console.log("Ground truth positive = manifest preflight_truth is 'candidate'. Negative = 'none' or 'uncertain'.\n");
console.log("threshold | TP | FN | TN | FP | recall | precision");
for (const t of PREFLIGHT_THRESHOLDS) {
  let tp = 0, fn = 0, tn = 0, fp = 0;
  for (const m of manifest) {
    const r = rawByPhoto.get(m.photo);
    const pf = r?.preflight;
    if (!pf || "error" in pf) continue;
    const passes = pf.decision === "candidate" && pf.packagedProductCount >= 1 && pf.confidence >= t;
    const truthPositive = m.preflight_truth === "candidate";
    if (truthPositive && passes) tp++;
    else if (truthPositive && !passes) fn++;
    else if (!truthPositive && !passes) tn++;
    else if (!truthPositive && passes) fp++;
  }
  const recall = tp + fn > 0 ? (tp / (tp + fn) * 100).toFixed(0) + "%" : "n/a";
  const precision = tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(0) + "%" : "n/a";
  console.log(`${String(t).padEnd(9)} | ${tp}  | ${fn}  | ${tn}  | ${fp}  | ${recall.padEnd(6)} | ${precision}`);
}

console.log("\n=== RESOLVER: detections with a curated-catalog candidate match ===\n");
console.log("photo | brand/name                          | vision_conf | catalog_match_id                     | match_conf");
for (const m of manifest) {
  const r = rawByPhoto.get(m.photo);
  const an = r?.analyze;
  if (!an || "error" in an) continue;
  for (const d of an.detections) {
    if (!d.catalogBestMatchId) continue;
    console.log(`${m.photo}  | ${(d.brand + " " + d.name).slice(0, 36).padEnd(36)} | ${d.visionConfidence.toFixed(2)}        | ${d.catalogBestMatchId.padEnd(37)} | ${d.catalogBestMatchConfidence}`);
  }
}

console.log("\n=== RESOLVER threshold sweep (photos with a ground-truth catalog SKU only) ===");
console.log("Confirmed iff catalogMatchConfidence>=threshold AND visionConfidence>=0.65 (MIN_VISION_CONFIDENCE_FOR_CONFIRMATION, unchanged).\n");
console.log("threshold | confirmed | correctly_confirmed | false_confirmations | missed_confirmations");
const catalogPhotos = manifest.filter((m) => m.in_reviewed_catalog === "yes");
for (const t of RESOLVER_THRESHOLDS) {
  let confirmed = 0, correct = 0, falseConfirm = 0, missed = 0;
  for (const m of catalogPhotos) {
    const r = rawByPhoto.get(m.photo);
    const an = r?.analyze;
    if (!an || "error" in an) continue;
    const best = an.detections.filter((d) => d.catalogBestMatchId).sort((a, b) => (b.catalogBestMatchConfidence ?? 0) - (a.catalogBestMatchConfidence ?? 0))[0];
    const wouldConfirm = best && best.catalogBestMatchConfidence >= t && best.visionConfidence >= 0.65;
    const shouldConfirm = m.resolver_truth === "confirmed";
    if (wouldConfirm) confirmed++;
    if (wouldConfirm && shouldConfirm) correct++;
    if (wouldConfirm && !shouldConfirm) falseConfirm++;
    if (!wouldConfirm && shouldConfirm) missed++;
  }
  console.log(`${String(t).padEnd(9)} | ${confirmed}         | ${correct}                    | ${falseConfirm}                    | ${missed}`);
}

console.log(`\nNote: this batch has no photographed near-miss (same brand/different flavor or size) for a real curated SKU, so the resolver sweep above cannot demonstrate false-confirmation protection — it only shows that the one true match (Schweppes Tonica Original, GTIN 8414100317357) stays confirmed at every threshold tested. A false-positive stress test needs at least one photo of a different Schweppes variant (e.g. Tonica Limon or Zero) next round.`);
