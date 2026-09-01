import fs from "node:fs/promises";
import path from "node:path";
import { preflightWithGemini, analyzeWithGemini } from "@/lib/vision/gemini";
import { CuratedProductCatalog } from "@/lib/catalog/curated-product-catalog";
import { CURATED_PRODUCTS } from "@/lib/catalog/curated-products";
import type { ServerEnv } from "@/lib/env";

const ROOT = "outputs/threshold-benchmark-2026-08-27";
const photoId = process.argv[2];
if (!photoId) throw new Error("Usage: tsx scripts/retry-photo.ts <photoId>");

const apiKey = process.env.GEMINI_API_KEY!;
const visionModel = process.env.GEMINI_VISION_MODEL || "gemini-3.6-flash";
const env: ServerEnv = {
  VISION_PROVIDER: "gemini",
  GEMINI_API_KEY: apiKey,
  GEMINI_VISION_MODEL: visionModel,
  GEMINI_PREFLIGHT_MODEL: visionModel,
  DATABASE_URL: undefined,
  RATE_LIMIT_SECRET: undefined,
  USDA_FDC_API_KEY: undefined,
  OPEN_FOOD_FACTS_USER_AGENT: undefined,
};

async function main() {
  const catalog = new CuratedProductCatalog(CURATED_PRODUCTS);
  const pfB64 = (await fs.readFile(path.join(ROOT, "fixtures_preflight", `${photoId}.jpg`))).toString("base64");
  const anB64 = (await fs.readFile(path.join(ROOT, "fixtures_analyze", `${photoId}.jpg`))).toString("base64");

  const pf = await preflightWithGemini({ clientFrameId: `retry-${photoId}`, imageBase64: pfB64, mimeType: "image/jpeg" }, env, performance.now());
  console.log("preflight", JSON.stringify(pf));

  const an = await analyzeWithGemini({ clientFrameId: `retry-${photoId}`, imageBase64: anB64, mimeType: "image/jpeg", context: "shelf" }, env, performance.now());
  const dets = await Promise.all(
    an.detections.map(async (d) => {
      const cand = {
        brand: d.visualCandidate.brand,
        name: d.visualCandidate.name,
        packSize: d.visualCandidate.packSize,
        gtin: d.visualCandidate.gtin,
        confidence: d.confidence,
        estimatedSugarPer100g: d.score.sugarPer100g,
        estimateReason: d.estimateReason,
      };
      const [best] = await catalog.searchCandidates(cand, 1);
      return {
        brand: d.visualCandidate.brand,
        name: d.visualCandidate.name,
        packSize: d.visualCandidate.packSize,
        visionConfidence: d.confidence,
        catalogBestMatchId: best?.product.id ?? null,
        catalogBestMatchConfidence: best?.confidence ?? null,
      };
    }),
  );
  console.log("analyze", JSON.stringify(dets));

  const raw = JSON.parse(await fs.readFile(path.join(ROOT, "raw_results.json"), "utf8"));
  const idx = raw.findIndex((r: { photo: string }) => r.photo === photoId);
  const updated = {
    photo: photoId,
    preflight: { decision: pf.decision, confidence: pf.confidence, packagedProductCount: pf.packagedProductCount, reasonCode: pf.reasonCode },
    analyze: { detections: dets },
  };
  if (idx >= 0) raw[idx] = updated;
  else raw.push(updated);
  raw.sort((a: { photo: string }, b: { photo: string }) => a.photo.localeCompare(b.photo));
  await fs.writeFile(path.join(ROOT, "raw_results.json"), JSON.stringify(raw, null, 2));
  console.log("updated raw_results.json, total", raw.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
