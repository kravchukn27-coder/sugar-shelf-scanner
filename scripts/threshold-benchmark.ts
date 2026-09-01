import fs from "node:fs/promises";
import path from "node:path";
import { preflightWithGemini, analyzeWithGemini } from "@/lib/vision/gemini";
import { CuratedProductCatalog } from "@/lib/catalog/curated-product-catalog";
import { CURATED_PRODUCTS } from "@/lib/catalog/curated-products";
import type { ServerEnv } from "@/lib/env";

/**
 * Offline threshold-calibration harness for the preflight (0.65) and
 * resolver (0.85) gates. Runs the real Gemini + catalog code paths against
 * a fixed local fixture set and dumps raw per-photo results — no thresholds
 * are baked in here, so the same run can be swept against many cutoffs by
 * `scripts/threshold-sweep.mjs` without spending more Gemini tokens.
 */

const ROOT = "outputs/threshold-benchmark-2026-08-27";
const PREFLIGHT_DIR = path.join(ROOT, "fixtures_preflight");
const ANALYZE_DIR = path.join(ROOT, "fixtures_analyze");
const OUT_JSON = path.join(ROOT, "raw_results.json");
const OUT_CSV = path.join(ROOT, "raw_results.csv");

function env(): ServerEnv {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to .env.local or export it before running this script.");
  const visionModel = process.env.GEMINI_VISION_MODEL || "gemini-3.6-flash";
  return {
    VISION_PROVIDER: "gemini",
    GEMINI_API_KEY: apiKey,
    GEMINI_VISION_MODEL: visionModel,
    GEMINI_PREFLIGHT_MODEL: process.env.GEMINI_PREFLIGHT_MODEL || visionModel,
    DATABASE_URL: undefined,
    RATE_LIMIT_SECRET: undefined,
    USDA_FDC_API_KEY: undefined,
    OPEN_FOOD_FACTS_USER_AGENT: undefined,
  };
}

async function toBase64(filePath: string) {
  const buf = await fs.readFile(filePath);
  return buf.toString("base64");
}

async function listPhotoIds() {
  const names = await fs.readdir(ANALYZE_DIR);
  return names.filter((n) => n.endsWith(".jpg")).map((n) => n.replace(/\.jpg$/, "")).sort();
}

type RawResult = {
  photo: string;
  preflight: {
    decision: string;
    confidence: number;
    packagedProductCount: number;
    reasonCode: string;
  } | { error: string };
  analyze: {
    detections: Array<{
      brand: string | null;
      name: string | null;
      packSize: string | null;
      visionConfidence: number;
      catalogBestMatchId: string | null;
      catalogBestMatchConfidence: number | null;
      catalogBestMatchDecision: string | null;
    }>;
  } | { error: string };
};

async function main() {
  const serverEnv = env();
  const catalog = new CuratedProductCatalog(CURATED_PRODUCTS);
  const photoIds = await listPhotoIds();
  const results: RawResult[] = [];

  for (const [index, photoId] of photoIds.entries()) {
    console.log(`[${index + 1}/${photoIds.length}] ${photoId}`);
    const receivedAt = performance.now();

    let preflight: RawResult["preflight"];
    try {
      const preflightBase64 = await toBase64(path.join(PREFLIGHT_DIR, `${photoId}.jpg`));
      const response = await preflightWithGemini(
        { clientFrameId: `bench-${photoId}`, imageBase64: preflightBase64, mimeType: "image/jpeg" },
        serverEnv,
        receivedAt,
      );
      preflight = {
        decision: response.decision,
        confidence: response.confidence,
        packagedProductCount: response.packagedProductCount,
        reasonCode: response.reasonCode,
      };
      console.log(`  preflight: ${response.decision} conf=${response.confidence} count=${response.packagedProductCount}`);
    } catch (error) {
      preflight = { error: error instanceof Error ? error.message : String(error) };
      console.log(`  preflight: ERROR ${preflight.error}`);
    }

    let analyze: RawResult["analyze"];
    try {
      const analyzeBase64 = await toBase64(path.join(ANALYZE_DIR, `${photoId}.jpg`));
      const response = await analyzeWithGemini(
        { clientFrameId: `bench-${photoId}`, imageBase64: analyzeBase64, mimeType: "image/jpeg", context: "shelf" },
        serverEnv,
        receivedAt,
      );
      const detections = await Promise.all(
        response.detections.map(async (detection) => {
          const candidate = {
            brand: detection.visualCandidate.brand,
            name: detection.visualCandidate.name,
            packSize: detection.visualCandidate.packSize,
            gtin: detection.visualCandidate.gtin,
            confidence: detection.confidence,
            estimatedSugarPer100g: detection.score.sugarPer100g,
            estimateReason: detection.estimateReason,
          };
          const [best] = await catalog.searchCandidates(candidate, 1);
          return {
            brand: detection.visualCandidate.brand,
            name: detection.visualCandidate.name,
            packSize: detection.visualCandidate.packSize,
            visionConfidence: detection.confidence,
            catalogBestMatchId: best?.product.id ?? null,
            catalogBestMatchConfidence: best?.confidence ?? null,
            catalogBestMatchDecision: (best as unknown as { decision?: string })?.decision ?? null,
          };
        }),
      );
      analyze = { detections };
      console.log(`  analyze: ${detections.length} detection(s)`);
      for (const d of detections) {
        console.log(`    - ${d.brand ?? "?"} ${d.name ?? "?"} visionConf=${d.visionConfidence} catalog=${d.catalogBestMatchId ?? "none"}@${d.catalogBestMatchConfidence ?? "-"}`);
      }
    } catch (error) {
      analyze = { error: error instanceof Error ? error.message : String(error) };
      console.log(`  analyze: ERROR ${analyze.error}`);
    }

    results.push({ photo: photoId, preflight, analyze });
    await fs.writeFile(OUT_JSON, JSON.stringify(results, null, 2));
  }

  const csvRows = [["photo", "preflight_decision", "preflight_confidence", "preflight_count", "preflight_reasonCode", "detection_index", "brand", "name", "vision_confidence", "catalog_match_id", "catalog_match_confidence"]];
  for (const r of results) {
    const pf = "error" in r.preflight ? { decision: "ERROR", confidence: "", packagedProductCount: "", reasonCode: r.preflight.error } : r.preflight;
    const detections = "error" in r.analyze ? [] : r.analyze.detections;
    if (detections.length === 0) {
      csvRows.push([r.photo, String(pf.decision), String(pf.confidence), String(pf.packagedProductCount), String(pf.reasonCode), "", "", "", "", "", ""]);
    } else {
      detections.forEach((d, i) => {
        csvRows.push([r.photo, String(pf.decision), String(pf.confidence), String(pf.packagedProductCount), String(pf.reasonCode), String(i), d.brand ?? "", d.name ?? "", String(d.visionConfidence), d.catalogBestMatchId ?? "", String(d.catalogBestMatchConfidence ?? "")]);
      });
    }
  }
  const csv = csvRows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
  await fs.writeFile(OUT_CSV, csv);

  console.log(`\nDone. Wrote ${results.length} rows to ${OUT_JSON} and ${OUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
