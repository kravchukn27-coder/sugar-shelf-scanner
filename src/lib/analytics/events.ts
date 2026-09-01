import { Pool, type QueryResultRow } from "pg";

export type AnalyticsEventSource = "browser" | "server" | "stripe" | "system";

export type AnalyticsEvent = {
  eventName: string;
  source: AnalyticsEventSource;
  properties: Record<string, unknown>;
  subjectHash?: string | null;
  occurredAt?: Date;
};

export type AnalyticsEventRow = {
  id: string;
  occurred_at: Date;
  event_name: string;
  source: AnalyticsEventSource;
  properties: Record<string, unknown>;
};

export type AnalyticsQueryExecutor = {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
};

type PoolHolder = { pool?: Pool };
const globalAnalyticsPool = globalThis as typeof globalThis & { __sugarAnalyticsPool?: PoolHolder };

function getPool(databaseUrl: string): Pool {
  const holder = globalAnalyticsPool.__sugarAnalyticsPool ??= {};
  if (!holder.pool) {
    // Analytics must never consume all database connections or delay a scan.
    holder.pool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 1_500,
      query_timeout: 1_500,
    });
  }
  return holder.pool;
}

export function isAnalyticsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.ANALYTICS_ENABLED === "true" && Boolean(environment.DATABASE_URL);
}

/**
 * Persists a single dashboard event. The caller controls the event contract;
 * this module only provides a shared database boundary and parameterized SQL.
 */
export async function recordAnalyticsEvent(event: AnalyticsEvent, executor?: AnalyticsQueryExecutor): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!isAnalyticsEnabled() || (!executor && !databaseUrl)) return false;

  const occurredAt = event.occurredAt ?? new Date();
  try {
    await (executor ?? getPool(databaseUrl!)).query(
      `INSERT INTO analytics_events (occurred_at, event_name, source, properties, subject_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [occurredAt, event.eventName, event.source, JSON.stringify(event.properties), event.subjectHash ?? null],
    );
    return true;
  } catch {
    // Telemetry is observational: an unavailable analytics DB must not alter a
    // scanner, payment, or catalog response.
    return false;
  }
}

/** Fire-and-forget helper for existing synchronous observability call sites. */
export function queueAnalyticsEvent(event: AnalyticsEvent) {
  void recordAnalyticsEvent(event);
}

export async function listAnalyticsEvents(
  options: { since: Date; until?: Date; eventNames?: readonly string[]; limit?: number },
  executor?: AnalyticsQueryExecutor,
): Promise<AnalyticsEventRow[]> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!isAnalyticsEnabled() || (!executor && !databaseUrl)) return [];

  const values: unknown[] = [options.since, options.until ?? new Date()];
  const clauses = ["occurred_at >= $1", "occurred_at <= $2"];
  if (options.eventNames?.length) {
    values.push(options.eventNames);
    clauses.push(`event_name = ANY($${values.length}::text[])`);
  }
  values.push(Math.min(Math.max(options.limit ?? 5_000, 1), 10_000));

  try {
    const result = await (executor ?? getPool(databaseUrl!)).query<AnalyticsEventRow>(
      `SELECT id, occurred_at, event_name, source, properties
       FROM analytics_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY occurred_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  } catch {
    return [];
  }
}
