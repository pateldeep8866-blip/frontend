-- ============================================================
-- YUNI Operational Memory — Supabase Schema
-- Run this in the Supabase SQL editor once.
-- ============================================================

-- Site snapshots: full system state captured every brief call
CREATE TABLE IF NOT EXISTS site_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  captured_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot      JSONB       NOT NULL,
  alert_count   INT         NOT NULL DEFAULT 0,
  db_status     TEXT,
  quant_status  TEXT,
  win_rate      NUMERIC
);

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS idx_snapshots_captured ON site_snapshots (captured_utc DESC);

-- Trim to last 10,000 snapshots automatically (optional — uses pg_cron if enabled)
-- SELECT cron.schedule('trim-snapshots', '0 * * * *',
--   $$DELETE FROM site_snapshots WHERE id NOT IN (SELECT id FROM site_snapshots ORDER BY captured_utc DESC LIMIT 10000)$$);


-- YUNI briefings: structured briefing objects for ambient loop memory
CREATE TABLE IF NOT EXISTS yuni_briefings (
  id            BIGSERIAL PRIMARY KEY,
  captured_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT        NOT NULL DEFAULT 'ambient',  -- 'ambient' | 'on_demand'
  briefing      JSONB       NOT NULL,
  alerts        JSONB,
  summary_text  TEXT        -- optional: natural language summary from YUNI
);

CREATE INDEX IF NOT EXISTS idx_briefings_captured ON yuni_briefings (captured_utc DESC);


-- Admin events: mirrors system_log for cross-session YUNI memory
CREATE TABLE IF NOT EXISTS admin_events (
  id           BIGSERIAL PRIMARY KEY,
  event_utc    TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type   TEXT        NOT NULL,
  reason       TEXT,
  detail       JSONB
);

CREATE INDEX IF NOT EXISTS idx_admin_events_type ON admin_events (event_type, event_utc DESC);


-- Row Level Security
-- All tables: service role can do anything; anon can only SELECT (read-only for YUNI dashboard)

ALTER TABLE site_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE yuni_briefings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_events    ENABLE ROW LEVEL SECURITY;

-- Allow anon reads (used by front-end Supabase client)
CREATE POLICY "anon read snapshots"   ON site_snapshots  FOR SELECT USING (true);
CREATE POLICY "anon read briefings"   ON yuni_briefings  FOR SELECT USING (true);
CREATE POLICY "anon read events"      ON admin_events    FOR SELECT USING (true);

-- Service role bypass (no extra policy needed — service role skips RLS by default)
