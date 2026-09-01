-- Product analytics is intentionally separate from catalog and access-pass
-- data. Events are append-only so the dashboard can show a live window while
-- a later job compacts older data into hourly rollups.
CREATE TABLE IF NOT EXISTS analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_name text NOT NULL,
  source text NOT NULL DEFAULT 'server'
    CHECK (source IN ('browser', 'server', 'stripe', 'system')),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(properties) = 'object')
);

CREATE INDEX IF NOT EXISTS analytics_events_occurred_at_idx
  ON analytics_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS analytics_events_name_occurred_at_idx
  ON analytics_events (event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS analytics_events_source_occurred_at_idx
  ON analytics_events (source, occurred_at DESC);

-- Reserved for a scheduled rollup job once event volume makes raw-event
-- dashboard queries unnecessary. The first dashboard release reads live data
-- from analytics_events, so applying this migration needs no background job.
CREATE TABLE IF NOT EXISTS analytics_event_rollups (
  bucket_start timestamptz NOT NULL,
  event_name text NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(dimensions) = 'object'),
  event_count bigint NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  numeric_totals jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(numeric_totals) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, event_name, dimensions)
);

CREATE INDEX IF NOT EXISTS analytics_event_rollups_event_bucket_idx
  ON analytics_event_rollups (event_name, bucket_start DESC);
