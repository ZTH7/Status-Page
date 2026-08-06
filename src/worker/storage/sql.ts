export const UPSERT_DAILY_SUMMARY = `
  INSERT INTO daily_summaries (
    monitor_id,
    day,
    location,
    check_count,
    failed_check_count,
    response_time_sum,
    response_count,
    highest_severity
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1
    FROM monitor_state
    WHERE monitor_id = ?
      AND latest_checked_at = ?
  )
  ON CONFLICT(monitor_id, day, location) DO UPDATE SET
    check_count = daily_summaries.check_count + excluded.check_count,
    failed_check_count = daily_summaries.failed_check_count + excluded.failed_check_count,
    response_time_sum = daily_summaries.response_time_sum + excluded.response_time_sum,
    response_count = daily_summaries.response_count + excluded.response_count,
    highest_severity = CASE
      WHEN (
        CASE daily_summaries.highest_severity
          WHEN 'operational' THEN 0
          WHEN 'degraded' THEN 1
          WHEN 'outage' THEN 2
        END
      ) >= (
        CASE excluded.highest_severity
          WHEN 'operational' THEN 0
          WHEN 'degraded' THEN 1
          WHEN 'outage' THEN 2
        END
      ) THEN daily_summaries.highest_severity
      ELSE excluded.highest_severity
    END
`;

export const UPSERT_MONITOR_STATE = `
  INSERT INTO monitor_state (
    monitor_id,
    level,
    consecutive_failures,
    consecutive_successes,
    first_failed_at,
    latest_checked_at,
    latest_success,
    latest_http_status,
    latest_status_text,
    latest_response_ms,
    latest_location,
    latest_error_code
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(monitor_id) DO UPDATE SET
    level = excluded.level,
    consecutive_failures = excluded.consecutive_failures,
    consecutive_successes = excluded.consecutive_successes,
    first_failed_at = excluded.first_failed_at,
    latest_checked_at = excluded.latest_checked_at,
    latest_success = excluded.latest_success,
    latest_http_status = excluded.latest_http_status,
    latest_status_text = excluded.latest_status_text,
    latest_response_ms = excluded.latest_response_ms,
    latest_location = excluded.latest_location,
    latest_error_code = excluded.latest_error_code
  WHERE excluded.latest_checked_at > monitor_state.latest_checked_at
`;

export const INSERT_INCIDENT = `
  INSERT INTO incidents (
    id,
    monitor_id,
    first_failed_at,
    degraded_at,
    outage_at,
    recovered_at,
    highest_severity
  )
  SELECT ?, ?, ?, ?, NULL, NULL, 'degraded'
  WHERE EXISTS (
    SELECT 1
    FROM monitor_state
    WHERE monitor_id = ?
      AND latest_checked_at = ?
  )
`;

export const ESCALATE_INCIDENT = `
  UPDATE incidents
  SET outage_at = ?, highest_severity = 'outage'
  WHERE id = ?
    AND EXISTS (
      SELECT 1
      FROM monitor_state
      WHERE monitor_id = ?
        AND latest_checked_at = ?
    )
`;

export const RECOVER_INCIDENT = `
  UPDATE incidents
  SET recovered_at = ?
  WHERE id = ?
    AND EXISTS (
      SELECT 1
      FROM monitor_state
      WHERE monitor_id = ?
        AND latest_checked_at = ?
    )
`;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function selectMonitorStatesSql(monitorCount: number): string {
  return `
    SELECT
      monitor_id,
      level,
      consecutive_failures,
      consecutive_successes,
      first_failed_at,
      latest_checked_at,
      latest_success,
      latest_http_status,
      latest_status_text,
      latest_response_ms,
      latest_location,
      latest_error_code
    FROM monitor_state
    WHERE monitor_id IN (${placeholders(monitorCount)})
    ORDER BY monitor_id
  `;
}

export function selectDailySummariesSql(monitorCount: number): string {
  return `
    SELECT
      monitor_id,
      day,
      location,
      check_count,
      failed_check_count,
      response_time_sum,
      response_count,
      highest_severity
    FROM daily_summaries
    WHERE monitor_id IN (${placeholders(monitorCount)})
      AND day >= ?
    ORDER BY day, monitor_id, location
  `;
}

export function selectOverlappingIncidentsSql(monitorCount: number): string {
  return `
    SELECT
      id,
      monitor_id,
      first_failed_at,
      degraded_at,
      outage_at,
      recovered_at,
      highest_severity
    FROM incidents
    WHERE monitor_id IN (${placeholders(monitorCount)})
      AND first_failed_at <= ?
      AND (recovered_at IS NULL OR recovered_at >= ?)
    ORDER BY first_failed_at DESC, id
  `;
}
