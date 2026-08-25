import { NextResponse } from "next/server";
import { preflightScanRequestSchema, preflightScanResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { preflightWithGemini, VisionRequestError } from "@/lib/vision/gemini";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = preflightScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preflight request", issues: parsed.error.flatten() }, { status: 400 });
  }

  let env;
  try {
    env = getServerEnv();
  } catch {
    return NextResponse.json({ error: "Vision service configuration is invalid." }, { status: 503 });
  }

  try {
    // A deterministic mock response keeps local UI work possible without a
    // Gemini key. It has no product identity or nutrition meaning.
    const response = env.VISION_PROVIDER === "gemini"
      ? await preflightWithGemini(parsed.data, env)
      : {
          clientFrameId: parsed.data.clientFrameId,
          provider: "mock" as const,
          decision: "candidate" as const,
          packagedProductCount: 1,
          confidence: 0.9,
          reasonCode: "packaged_food_or_drink" as const,
          analyzedAt: new Date().toISOString(),
        };
    return NextResponse.json(preflightScanResponseSchema.parse(response));
  } catch (error) {
    if (error instanceof VisionRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to preflight this frame.", code: "internal_error" }, { status: 500 });
  }
}
