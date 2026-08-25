import { z } from "zod";

export const resolutionStatusSchema = z.enum(["confirmed", "estimate", "unknown"]);
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;

export const scoreBandSchema = z.enum(["green", "yellow", "orange", "red", "unknown"]);
export type ScoreBand = z.infer<typeof scoreBandSchema>;

export const normalizedBoxSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) })
  .superRefine((box, context) => {
    if (box.x + box.width > 1 || box.y + box.height > 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Box must be contained in the normalized image." });
    }
  });
export type NormalizedBox = z.infer<typeof normalizedBoxSchema>;

export const scoreSchema = z.object({
  band: scoreBandSchema,
  sugarPer100g: z.number().nonnegative().nullable(),
  source: z.enum(["catalog", "vision_estimate", "nutrition_label", "unavailable"]),
});
export type SugarScore = z.infer<typeof scoreSchema>;

export const productSummarySchema = z.object({
  id: z.string().min(1),
  gtin: z.string().nullable(),
  brand: z.string().nullable(),
  name: z.string().min(1),
  packSize: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  proteinPer100g: z.number().nonnegative().nullable(),
  score: scoreSchema,
});
export type ProductSummary = z.infer<typeof productSummarySchema>;
