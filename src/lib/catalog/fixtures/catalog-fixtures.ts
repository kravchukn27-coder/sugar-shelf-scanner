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

export { CURATED_PRODUCTS };
