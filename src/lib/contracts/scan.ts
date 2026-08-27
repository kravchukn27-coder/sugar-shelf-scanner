import { z } from "zod";
import { isValidGtin } from "@/lib/catalog/gtin";
import { normalizedBoxSchema, productSummarySchema, resolutionStatusSchema, scoreSchema } from "@/lib/contracts/product";

export const scanContextSchema = z.enum(["shelf", "barcode", "nutrition_label"]);

export const analyzeScanRequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  context: scanContextSchema.default("shelf"),
  clientFrameId: z.string().min(1).max(128),
});
export type AnalyzeScanRequest = z.infer<typeof analyzeScanRequestSchema>;

// Preflight deliberately has a much smaller contract than a shelf analysis.
// It answers only whether it is worth capturing a high-resolution frame; it
// never produces product identities, nutrition, scores, or bounding boxes.
export const preflightScanRequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  context: z.literal("shelf").default("shelf"),
  clientFrameId: z.string().min(1).max(128),
});
export type PreflightScanRequest = z.infer<typeof preflightScanRequestSchema>;

export const preflightDecisionSchema = z.enum(["candidate", "none", "uncertain"]);
export const preflightReasonCodeSchema = z.enum([
  "packaged_food_or_drink",
  "no_packaged_product",
  "person_or_document",
  "screen",
  "blur_or_distance",
]);

export const preflightScanResponseSchema = z.object({
  clientFrameId: z.string().min(1),
  provider: z.enum(["mock", "gemini"]),
  decision: preflightDecisionSchema,
  packagedProductCount: z.number().int().min(0).max(20),
  confidence: z.number().min(0).max(1),
  reasonCode: preflightReasonCodeSchema,
  analyzedAt: z.string().datetime(),
});
export type PreflightScanResponse = z.infer<typeof preflightScanResponseSchema>;

export const detectionSchema = z.object({
  id: z.string().min(1),
  box: normalizedBoxSchema,
  confidence: z.number().min(0).max(1),
  status: resolutionStatusSchema,
  visualCandidate: z.object({ brand: z.string().nullable(), name: z.string().nullable(), packSize: z.string().nullable(), gtin: z.string().nullable().optional() }),
  score: scoreSchema,
  product: productSummarySchema.nullable(),
  estimateReason: z.string().nullable(),
});
export type Detection = z.infer<typeof detectionSchema>;

export const analyzeScanResponseSchema = z.object({
  scanId: z.string().min(1),
  clientFrameId: z.string().min(1),
  provider: z.enum(["mock", "gemini"]),
  detections: z.array(detectionSchema).max(20),
  analyzedAt: z.string().datetime(),
});
export type AnalyzeScanResponse = z.infer<typeof analyzeScanResponseSchema>;

// Recovery sends a barcode only. In particular, it never uploads recovery
// frames or browser OCR text to Gemini or any other provider.
export const barcodeRecoveryRequestSchema = z.object({
  gtin: z.string().regex(/^\d{8}$|^\d{12,14}$/).refine(isValidGtin, "Invalid GTIN check digit"),
});
export const barcodeRecoveryResponseSchema = z.object({
  status: resolutionStatusSchema,
  product: productSummarySchema.nullable(),
  score: scoreSchema,
  estimateReason: z.string().nullable(),
});
export type BarcodeRecoveryResponse = z.infer<typeof barcodeRecoveryResponseSchema>;

// A recovery label is a deliberate, one-shot submission from the recovery
// camera. It is separate from `analyze` so a recovery capture cannot be fed
// into the live shelf scheduler by accident.
export const nutritionLabelRecoveryRequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  // A literal makes consent fail closed: omitting it or sending `false` never
  // reaches the provider.
  labelCaptureConsented: z.literal(true),
}).strict();
export type NutritionLabelRecoveryRequest = z.infer<typeof nutritionLabelRecoveryRequestSchema>;

const extractionTextSchema = z.string().trim().min(1).max(160).nullable();
const extractionPackSizeSchema = z.string().trim().min(1).max(40).nullable();
const extractionNutritionSchema = z.number().finite().min(0).max(100).nullable();
const extractionEnergySchema = z.number().finite().min(0).max(2000).nullable();

export const nutritionLabelFieldConfidenceSchema = z.object({
  brand: z.number().finite().min(0).max(1).nullable(),
  name: z.number().finite().min(0).max(1).nullable(),
  packSize: z.number().finite().min(0).max(1).nullable(),
  energyKcal: z.number().finite().min(0).max(1).nullable(),
  proteinPer100g: z.number().finite().min(0).max(1).nullable(),
  fatPer100g: z.number().finite().min(0).max(1).nullable(),
  carbohydratesPer100g: z.number().finite().min(0).max(1).nullable(),
  sugarPer100g: z.number().finite().min(0).max(1).nullable(),
}).strict();

export const nutritionLabelDraftSchema = z.object({
  brand: extractionTextSchema,
  name: extractionTextSchema,
  packSize: extractionPackSizeSchema,
  energyKcal: extractionEnergySchema,
  proteinPer100g: extractionNutritionSchema,
  fatPer100g: extractionNutritionSchema,
  carbohydratesPer100g: extractionNutritionSchema,
  sugarPer100g: extractionNutritionSchema,
  fieldConfidence: nutritionLabelFieldConfidenceSchema,
}).strict();
export type NutritionLabelDraft = z.infer<typeof nutritionLabelDraftSchema>;

export const nutritionLabelRecoveryResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("nutrition_label"), draft: nutritionLabelDraftSchema }).strict(),
  z.object({ outcome: z.literal("unreadable") }).strict(),
]);
export type NutritionLabelRecoveryResponse = z.infer<typeof nutritionLabelRecoveryResponseSchema>;
