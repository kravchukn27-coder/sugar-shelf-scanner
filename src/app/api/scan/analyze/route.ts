import { NextResponse } from "next/server";
import { analyzeScanRequestSchema, analyzeScanResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { getMockShelfScan } from "@/lib/mock/scan-fixtures";
import { analyzeWithGemini, VisionRequestError } from "@/lib/vision/gemini";
import { resolveScan } from "@/lib/catalog/resolve-scan";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = analyzeScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scan request", issues: parsed.error.flatten() }, { status: 400 });
  }

  let env;
  try {
    env = getServerEnv();
  } catch {
    return NextResponse.json({ error: "Vision service configuration is invalid." }, { status: 503 });
  }

  try {
    const visionResponse = env.VISION_PROVIDER === "gemini"
      ? await analyzeWithGemini(parsed.data, env)
      : getMockShelfScan(parsed.data.clientFrameId);
    const response = await resolveScan(visionResponse);
    return NextResponse.json(analyzeScanResponseSchema.parse(response));
  } catch (error) {
    if (error instanceof VisionRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to analyze this frame.", code: "internal_error" }, { status: 500 });
  }
}
