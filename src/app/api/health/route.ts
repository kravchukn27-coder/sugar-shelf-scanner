import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getRuntimeCatalogStatus } from "@/lib/catalog/runtime-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getServerEnv();
  const catalog = await getRuntimeCatalogStatus({ databaseUrl: env.DATABASE_URL });
  return NextResponse.json({ status: "ok", visionProvider: env.VISION_PROVIDER, catalog });
}
