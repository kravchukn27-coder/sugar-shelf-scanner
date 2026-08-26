import { barcodeRecoveryRequestSchema, barcodeRecoveryResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { resolveBarcode } from "@/lib/catalog/resolve-scan";

export const runtime = "nodejs";

/**
 * Barcode-only catalog recovery. This endpoint intentionally accepts neither
 * images nor OCR strings, so it cannot become a second Gemini analysis path.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = barcodeRecoveryRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid barcode recovery request" }, { status: 400 });
  try {
    const resolved = await resolveBarcode(parsed.data.gtin, getServerEnv());
    return Response.json(barcodeRecoveryResponseSchema.parse(resolved));
  } catch {
    return Response.json({ error: "Barcode lookup is temporarily unavailable." }, { status: 503 });
  }
}
