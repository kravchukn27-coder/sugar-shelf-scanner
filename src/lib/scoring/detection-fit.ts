import type { Detection } from "@/lib/contracts/scan";
import { calculateSugarFit, type SugarFitResult } from "./sugar-fit";

/**
 * The single mapping from a detection to the Your Fit score. The results list
 * prints this number and the list is ranked by it, so both must read the same
 * fields in the same order of preference: a ranking built from any other proxy
 * puts the rows out of order against the scores printed beside them.
 */
export function sugarFitForDetection(detection: Detection): SugarFitResult | null {
  return calculateSugarFit({
    sugarPer100g: detection.score.sugarPer100g,
    packSize: detection.product?.packSize ?? detection.visualCandidate.packSize,
    brand: detection.product?.brand ?? detection.visualCandidate.brand,
    name: detection.visualCandidate.name ?? detection.product?.name,
    energyKcalPer100g: detection.product?.energyKcalPer100g,
    proteinPer100g: detection.product?.proteinPer100g,
    fatPer100g: detection.product?.fatPer100g,
    carbohydratesPer100g: detection.product?.carbohydratesPer100g,
  });
}
