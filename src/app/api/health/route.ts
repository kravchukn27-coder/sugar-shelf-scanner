import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getRuntimeCatalogStatus } from "@/lib/catalog/runtime-catalog";
import { queueOperationalIncident } from "@/lib/observability/telegram-alert";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = getServerEnv();
    const catalog = await getRuntimeCatalogStatus({ databaseUrl: env.DATABASE_URL });
    return NextResponse.json({ status: "ok", visionProvider: env.VISION_PROVIDER, catalog });
  } catch {
    queueOperationalIncident({ kind: "health_unavailable", route: "/api/health", status: 503 });
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
