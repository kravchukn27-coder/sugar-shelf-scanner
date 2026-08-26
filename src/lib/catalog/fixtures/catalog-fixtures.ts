import { CURATED_PRODUCTS } from "../curated-products";
import type { VisualCandidate } from "../types";

export const matchingChobaniCandidate: VisualCandidate = {
  brand: "Chobani",
  name: "Zero Sugar Greek Yogurt Strawberry",
  packSize: "5.3 oz",
  confidence: 0.96,
};

export const estimatedSnackCandidate: VisualCandidate = {
  brand: null,
  name: "Chocolate snack bar",
  packSize: null,
  confidence: 0.52,
  estimatedSugarPer100g: 24,
};

export const unknownCandidate: VisualCandidate = {
  brand: null,
  name: null,
  packSize: null,
  confidence: 0.3,
};

export const coronaSpainCandidates: readonly VisualCandidate[] = [
  { brand: "Corona", name: "Corona", packSize: "33 cl", confidence: 0.96 },
  { brand: "Corona", name: "Corona Extra", packSize: "330 ml", confidence: 0.96 },
  { brand: "Corona", name: "Cerveza", packSize: "33 cl", confidence: 0.96 },
];

export const wrongCoronaSpainCandidates: readonly VisualCandidate[] = [
  { brand: "Corona", name: "Corona Cero", packSize: "330 ml", confidence: 0.96 },
  { brand: "Corona", name: "Corona Extra", packSize: "355 ml", confidence: 0.96 },
];

export const matchingSpanishCatalogCandidates: readonly { candidate: VisualCandidate; productId: string; sugar: number; protein: number }[] = [
  {
    candidate: { brand: "Schweppes", name: "Tonica Original", packSize: "33 cl", confidence: 0.96 },
    productId: "schweppes-tonica-original-330ml-es",
    sugar: 2.4,
    protein: 0,
  },
  {
    candidate: { brand: "La Lechera", name: "Leche condensada", packSize: "370 g", confidence: 0.96 },
    productId: "la-lechera-leche-condensada-370g-es",
    sugar: 54.9,
    protein: 7.5,
  },
];

export const schweppesLimonCandidate: VisualCandidate = {
  brand: "Schweppes",
  name: "Tónica Limón",
  packSize: "330 ml",
  confidence: 0.96,
};

export { CURATED_PRODUCTS };
