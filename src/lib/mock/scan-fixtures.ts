import type { AnalyzeScanResponse } from "@/lib/contracts/scan";

const DEMO_TIME = "2026-08-25T00:00:00.000Z";

export function getMockShelfScan(clientFrameId: string): AnalyzeScanResponse {
  return {
    scanId: `mock-${clientFrameId}`,
    clientFrameId,
    provider: "mock",
    analyzedAt: DEMO_TIME,
    detections: [
      {
        id: "demo-chobani-zero-sugar",
        box: { x: 0.08, y: 0.2, width: 0.2, height: 0.48 },
        confidence: 0.96,
        status: "confirmed",
        visualCandidate: { brand: "Chobani", name: "Zero Sugar Greek Yogurt", packSize: "5.3 oz" },
        score: { band: "green", sugarPer100g: 2.7, source: "catalog" },
        product: { id: "demo-chobani-zero-sugar", gtin: "818290019065", brand: "Chobani", name: "Zero Sugar Greek Yogurt", packSize: "5.3 oz", imageUrl: null, energyKcalPer100g: 59, proteinPer100g: 10.6, fatPer100g: 0, carbohydratesPer100g: 4, score: { band: "green", sugarPer100g: 2.7, source: "catalog" } },
        estimateReason: null,
      },
      {
        id: "demo-nature-valley",
        box: { x: 0.38, y: 0.12, width: 0.22, height: 0.56 },
        confidence: 0.6,
        status: "estimate",
        visualCandidate: { brand: "Nature Valley", name: "Crunchy Granola Bars", packSize: "1.49 oz" },
        score: { band: "orange", sugarPer100g: 26, source: "vision_estimate" },
        product: null,
        estimateReason: "Packaging text and visual match suggest an approximate value.",
      },
      {
        id: "demo-unknown-snack",
        box: { x: 0.7, y: 0.28, width: 0.18, height: 0.35 },
        confidence: 0.53,
        status: "unknown",
        visualCandidate: { brand: null, name: "Snack bar", packSize: null },
        score: { band: "unknown", sugarPer100g: null, source: "unavailable" },
        product: null,
        estimateReason: "Take a closer photo, barcode, or nutrition label to confirm this product.",
      },
    ],
  };
}
