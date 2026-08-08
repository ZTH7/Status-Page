CREATE TABLE IF NOT EXISTS monitor_state (
  monitor_id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('operational', 'degraded', 'outage')),
  consecutive_failures INTEGER NOT NULL CHECK (consecutive_failures >= 0),
  consecutive_successes INTEGER NOT NULL CHECK (consecutive_successes >= 0),
  first_failed_at INTEGER,
  latest_checked_at INTEGER NOT NULL,
  latest_success INTEGER NOT NULL CHECK (latest_success IN (0, 1)),
  latest_http_status INTEGER,
  latest_status_text TEXT,
  latest_response_ms INTEGER CHECK (latest_response_ms IS NULL OR latest_response_ms >= 0),
  latest_location TEXT,
  latest_error_code TEXT CHECK (
    latest_error_code IS NULL OR latest_error_code IN ('timeout', 'dns', 'tls', 'network', 'unexpected')
  )
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  monitor_id TEXT NOT NULL,
  day TEXT NOT NULL,
  location TEXT NOT NULL,
  check_count INTEGER NOT NULL CHECK (check_count >= 0),
  failed_check_count INTEGER NOT NULL CHECK (failed_check_count >= 0),
  response_time_sum INTEGER NOT NULL CHECK (response_time_sum >= 0),
  response_count INTEGER NOT NULL CHECK (response_count >= 0),
  highest_severity TEXT NOT NULL CHECK (highest_severity IN ('operational', 'degraded', 'outage')),
  PRIMARY KEY (monitor_id, day, location)
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  first_failed_at INTEGER NOT NULL,
  degraded_at INTEGER NOT NULL,
  outage_at INTEGER,
  recovered_at INTEGER,
  highest_severity TEXT NOT NULL CHECK (highest_severity IN ('degraded', 'outage'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor_first_failed ON incidents (monitor_id, first_failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_first_failed ON incidents (first_failed_at DESC);
