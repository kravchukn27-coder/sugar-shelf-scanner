import { z } from "zod";
import { normalizedBoxSchema, productSummarySchema, resolutionStatusSchema, scoreSchema } from "@/lib/contracts/product";

export const scanContextSchema = z.enum(["shelf", "barcode", "nutrition_label"]);

export const analyzeScanRequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  context: scanContextSchema.default("shelf"),
  clientFrameId: z.string().min(1).max(128),
});
export type AnalyzeScanRequest = z.infer<typeof analyzeScanRequestSchema>;

export const detectionSchema = z.object({
  id: z.string().min(1),
  box: normalizedBoxSchema,
  confidence: z.number().min(0).max(1),
  status: resolutionStatusSchema,
  visualCandidate: z.object({ brand: z.string().nullable(), name: z.string().nullable(), packSize: z.string().nullable() }),
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
