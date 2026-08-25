import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  const env = getServerEnv();
  return NextResponse.json({ status: "ok", visionProvider: env.VISION_PROVIDER });
}
