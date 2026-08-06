import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { transitionMonitor } from '../../src/domain/status-machine'
import type {
  CheckResult,
  MonitorState,
  MonitorTransition,
} from '../../src/domain/types'
import { appConfig } from '../../src/generated/config'
import { buildStatusResponse } from '../../src/worker/api/status'
import {
  readCurrentStates,
  readDailySummariesSince,
  readIncidentsOverlapping,
} from '../../src/worker/storage/read-model'
import {
  DuplicateCheckBatchError,
  deleteExpiredChecks,
  loadMonitorStates,
  persistCheckBatch,
  type PersistedCheck,
} from '../../src/worker/storage/repository'
import {
  checkResultFromRow,
  dailySummaryFromRow,
  incidentFromRow,
  monitorStateFromRow,
  type CheckResultRow,
  type DailySummaryRow,
  type IncidentRow,
  type MonitorStateRow,
} from '../../src/worker/storage/rows'

const THRESHOLDS = {
  degradedAfterFailures: 1,
  outageAfterMinutes: 1,
  recoverAfterSuccesses: 1,
}

function result(
  checkedAt: number,
  overrides: Partial<CheckResult> = {},
): CheckResult {
  return {
    monitorId: 'blog',
    checkedAt,
    success: true,
    httpStatus: 200,
    statusText: 'OK',
    responseMs: 40,
    location: 'sfo',
    errorCode: null,
    ...overrides,
  }
}

function failedResult(
  checkedAt: number,
  overrides: Partial<CheckResult> = {},
): CheckResult {
  return result(checkedAt, {
    success: false,
    httpStatus: null,
    statusText: null,
    responseMs: null,
    errorCode: 'timeout',
    ...overrides,
  })
}

function persisted(
  previous: MonitorState | null,
  checkResult: CheckResult,
): PersistedCheck {
  return {
    result: checkResult,
    transition: transitionMonitor(previous, checkResult, THRESHOLDS),
  }
}

async function rows<T>(sql: string, ...bindings: unknown[]): Promise<T[]> {
  const query = env.DB.prepare(sql)
  const statement = bindings.length > 0 ? query.bind(...bindings) : query
  return (await statement.all<T>()).results
}

async function clearBusinessTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM check_results'),
    env.DB.prepare('DELETE FROM monitor_state'),
    env.DB.prepare('DELETE FROM daily_summaries'),
    env.DB.prepare('DELETE FROM incidents'),
  ])
}

beforeEach(clearBusinessTables)

describe('scheduled-check persistence', () => {
  it('keeps D1 and the public API aligned across the complete default threshold timeline', async () => {
    const start = Date.UTC(2026, 7, 5, 12)
    const timelineConfig = {
      site: { ...appConfig.site, historyDays: 1 },
      monitors: [appConfig.monitors[0]!],
    }
    const thresholds = appConfig.site.thresholds
    let previous: MonitorState | null = null
    const notifications: string[] = []

    async function apply(
      checkResult: CheckResult,
      expectedLevel: 'operational' | 'degraded' | 'outage',
    ): Promise<void> {
      const transition = transitionMonitor(previous, checkResult, thresholds)
      await persistCheckBatch(env.DB, [{ result: checkResult, transition }])
      previous = transition.next
      if (transition.notification)
        notifications.push(transition.notification.type)

      const publicStatus = await buildStatusResponse({
        config: timelineConfig,
        db: env.DB,
        now: () => checkResult.checkedAt,
      })
      expect(publicStatus.overall).toBe(expectedLevel)
      expect(publicStatus.monitors[0]?.level).toBe(expectedLevel)
    }

    await apply(result(start), 'operational')
    await apply(failedResult(start + 60_000), 'operational')
    await apply(failedResult(start + 120_000), 'degraded')
    await apply(failedResult(start + 61 * 60_000), 'outage')
    await apply(result(start + 62 * 60_000), 'outage')
    await apply(result(start + 63 * 60_000), 'operational')

    expect(notifications).toEqual(['failure', 'recovery'])
    expect(
      await rows('SELECT id, highest_severity, recovered_at FROM incidents'),
    ).toEqual([
      {
        id: `blog:${start + 60_000}`,
        highest_severity: 'outage',
        recovered_at: start + 63 * 60_000,
      },
    ])
    expect(
      await rows(
        'SELECT check_count, failed_check_count, highest_severity FROM daily_summaries',
      ),
    ).toEqual([
      { check_count: 6, failed_check_count: 3, highest_severity: 'outage' },
    ])
  })

  it('stores one successful initial check and its current state', async () => {
    const checkResult = result(Date.UTC(2026, 7, 5, 12))

    await persistCheckBatch(env.DB, [persisted(null, checkResult)])

    expect(
      await rows(
        'SELECT monitor_id, checked_at, success, http_status, status_text, response_ms, location, error_code FROM check_results',
      ),
    ).toEqual([
      {
        monitor_id: 'blog',
        checked_at: 1_785_931_200_000,
        success: 1,
        http_status: 200,
        status_text: 'OK',
        response_ms: 40,
        location: 'sfo',
        error_code: null,
      },
    ])
    expect(await loadMonitorStates(env.DB, ['blog'])).toEqual(
      new Map([
        [
          'blog',
          {
            monitorId: 'blog',
            level: 'operational',
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            firstFailedAt: null,
            latest: checkResult,
          },
        ],
      ]),
    )
  })

  it('counts a failed check without adding a response sample', async () => {
    const checkedAt = Date.UTC(2026, 7, 5, 12, 1)

    await persistCheckBatch(env.DB, [persisted(null, failedResult(checkedAt))])

    expect(
      await rows(
        'SELECT monitor_id, day, location, check_count, failed_check_count, response_time_sum, response_count, highest_severity FROM daily_summaries',
      ),
    ).toEqual([
      {
        monitor_id: 'blog',
        day: '2026-08-05',
        location: 'sfo',
        check_count: 1,
        failed_check_count: 1,
        response_time_sum: 0,
        response_count: 0,
        highest_severity: 'degraded',
      },
    ])
  })

  it('aggregates null and non-null response times independently', async () => {
    const first = persisted(
      null,
      result(Date.UTC(2026, 7, 5, 12), { responseMs: null }),
    )
    const second = persisted(
      first.transition.next,
      result(Date.UTC(2026, 7, 5, 12, 1), { responseMs: 75 }),
    )

    await persistCheckBatch(env.DB, [first])
    await persistCheckBatch(env.DB, [second])

    expect(
      await rows(
        'SELECT check_count, failed_check_count, response_time_sum, response_count FROM daily_summaries',
      ),
    ).toEqual([
      {
        check_count: 2,
        failed_check_count: 0,
        response_time_sum: 75,
        response_count: 1,
      },
    ])
  })

  it('keeps daily summaries for multiple PoPs separate and maps an empty location to unknown', async () => {
    const at = Date.UTC(2026, 7, 5, 12)
    const sfo = persisted(null, result(at, { location: 'sfo', responseMs: 30 }))
    const unknown = persisted(
      null,
      result(at + 1, { location: '', responseMs: 50 }),
    )

    await persistCheckBatch(env.DB, [sfo, unknown])

    expect(
      await rows(
        'SELECT location, check_count, response_time_sum, response_count FROM daily_summaries ORDER BY location',
      ),
    ).toEqual([
      {
        location: 'sfo',
        check_count: 1,
        response_time_sum: 30,
        response_count: 1,
      },
      {
        location: 'unknown',
        check_count: 1,
        response_time_sum: 50,
        response_count: 1,
      },
    ])
  })

  it('opens, escalates, and recovers the same incident while preserving outage severity', async () => {
    const first = persisted(null, failedResult(Date.UTC(2026, 7, 5, 12)))
    const second = persisted(
      first.transition.next,
      failedResult(Date.UTC(2026, 7, 5, 12, 1)),
    )
    const third = persisted(
      second.transition.next,
      result(Date.UTC(2026, 7, 5, 12, 2)),
    )

    await persistCheckBatch(env.DB, [first])
    expect(
      await rows(
        'SELECT id, monitor_id, first_failed_at, degraded_at, outage_at, recovered_at, highest_severity FROM incidents',
      ),
    ).toEqual([
      {
        id: 'blog:1785931200000',
        monitor_id: 'blog',
        first_failed_at: 1_785_931_200_000,
        degraded_at: 1_785_931_200_000,
        outage_at: null,
        recovered_at: null,
        highest_severity: 'degraded',
      },
    ])

    await persistCheckBatch(env.DB, [second])
    await persistCheckBatch(env.DB, [third])

    expect(
      await rows(
        'SELECT id, outage_at, recovered_at, highest_severity FROM incidents',
      ),
    ).toEqual([
      {
        id: 'blog:1785931200000',
        outage_at: 1_785_931_260_000,
        recovered_at: 1_785_931_320_000,
        highest_severity: 'outage',
      },
    ])
  })

  it('never downgrades a daily maximum from outage to degraded or operational', async () => {
    const first = persisted(null, failedResult(Date.UTC(2026, 7, 5, 12)))
    const outage = persisted(
      first.transition.next,
      failedResult(Date.UTC(2026, 7, 5, 12, 1)),
    )
    const recovered = persisted(
      outage.transition.next,
      result(Date.UTC(2026, 7, 5, 12, 2)),
    )
    const degradedAgain = persisted(
      recovered.transition.next,
      failedResult(Date.UTC(2026, 7, 5, 12, 3)),
    )

    for (const check of [first, outage, recovered, degradedAgain]) {
      await persistCheckBatch(env.DB, [check])
    }

    expect(
      await rows(
        'SELECT check_count, failed_check_count, highest_severity FROM daily_summaries',
      ),
    ).toEqual([
      { check_count: 4, failed_check_count: 3, highest_severity: 'outage' },
    ])
  })

  it('classifies a duplicate schedule and rolls back every statement in its batch', async () => {
    const at = Date.UTC(2026, 7, 5, 12)
    const existing = persisted(null, result(at))
    await persistCheckBatch(env.DB, [existing])

    const fresh = persisted(null, failedResult(at + 1, { monitorId: 'vault' }))
    const duplicate = persisted(existing.transition.next, result(at))
    expect(fresh.transition.incident).toEqual({
      type: 'open',
      incidentId: 'vault:1785931200001',
      firstFailedAt: 1_785_931_200_001,
      degradedAt: 1_785_931_200_001,
    })

    await expect(
      persistCheckBatch(env.DB, [fresh, duplicate]),
    ).rejects.toBeInstanceOf(DuplicateCheckBatchError)
    expect(
      await rows(
        'SELECT monitor_id, COUNT(*) AS count FROM check_results GROUP BY monitor_id ORDER BY monitor_id',
      ),
    ).toEqual([{ monitor_id: 'blog', count: 1 }])
    expect(
      await rows(
        'SELECT monitor_id, check_count FROM daily_summaries ORDER BY monitor_id',
      ),
    ).toEqual([{ monitor_id: 'blog', check_count: 1 }])
    expect(
      await rows('SELECT monitor_id FROM monitor_state ORDER BY monitor_id'),
    ).toEqual([{ monitor_id: 'blog' }])
    expect(await rows('SELECT COUNT(*) AS count FROM incidents')).toEqual([
      { count: 0 },
    ])
  })

  it('preserves non-duplicate D1 errors unchanged', async () => {
    const invalid = result(Date.UTC(2026, 7, 5, 12), { responseMs: -1 })

    await expect(
      persistCheckBatch(env.DB, [persisted(null, invalid)]),
    ).rejects.not.toBeInstanceOf(DuplicateCheckBatchError)
  })

  it('retains and summarizes a stale unseen raw result without changing state or incidents', async () => {
    const newer = persisted(null, result(Date.UTC(2026, 7, 5, 12, 2)))
    await persistCheckBatch(env.DB, [newer])

    const olderResult = failedResult(Date.UTC(2026, 7, 5, 12))
    const staleTransition: MonitorTransition = {
      next: newer.transition.next,
      incident: null,
      notification: null,
      dailySeverity: 'operational',
      stale: true,
    }
    await persistCheckBatch(env.DB, [
      { result: olderResult, transition: staleTransition },
    ])

    expect(
      await rows(
        'SELECT checked_at, success FROM check_results ORDER BY checked_at',
      ),
    ).toEqual([
      { checked_at: 1_785_931_200_000, success: 0 },
      { checked_at: 1_785_931_320_000, success: 1 },
    ])
    expect(
      await rows('SELECT check_count, failed_check_count FROM daily_summaries'),
    ).toEqual([{ check_count: 2, failed_check_count: 1 }])
    expect(
      (await loadMonitorStates(env.DB, ['blog'])).get('blog')?.latest.checkedAt,
    ).toBe(1_785_931_320_000)
    expect(await rows('SELECT COUNT(*) AS count FROM incidents')).toEqual([
      { count: 0 },
    ])
  })

  it('rejects an older incident mutation that becomes stale inside the D1 batch', async () => {
    const newer = persisted(null, result(Date.UTC(2026, 7, 5, 12, 2)))
    await persistCheckBatch(env.DB, [newer])

    const olderResult = failedResult(Date.UTC(2026, 7, 5, 12))
    const olderIncidentTransition = persisted(null, olderResult)
    expect(olderIncidentTransition.transition.stale).toBe(false)
    expect(olderIncidentTransition.transition.incident).toEqual({
      type: 'open',
      incidentId: 'blog:1785931200000',
      firstFailedAt: 1_785_931_200_000,
      degradedAt: 1_785_931_200_000,
    })

    await persistCheckBatch(env.DB, [olderIncidentTransition])

    expect(
      await rows(
        'SELECT checked_at, success FROM check_results ORDER BY checked_at',
      ),
    ).toEqual([
      { checked_at: 1_785_931_200_000, success: 0 },
      { checked_at: 1_785_931_320_000, success: 1 },
    ])
    expect(
      await rows(
        'SELECT check_count, failed_check_count, highest_severity FROM daily_summaries',
      ),
    ).toEqual([
      { check_count: 2, failed_check_count: 1, highest_severity: 'degraded' },
    ])
    expect((await loadMonitorStates(env.DB, ['blog'])).get('blog')).toEqual(
      newer.transition.next,
    )
    expect(await rows('SELECT COUNT(*) AS count FROM incidents')).toEqual([
      { count: 0 },
    ])
  })

  it('returns immediately for empty state IDs and empty write batches', async () => {
    await persistCheckBatch(env.DB, [])

    expect(await loadMonitorStates(env.DB, [])).toEqual(new Map())
    expect(await rows('SELECT COUNT(*) AS count FROM check_results')).toEqual([
      { count: 0 },
    ])
  })
})

describe('strict row conversion', () => {
  const validCheckRow: CheckResultRow = {
    monitor_id: 'blog',
    checked_at: 1000,
    success: 1,
    http_status: 200,
    status_text: 'OK',
    response_ms: 42,
    location: 'sfo',
    error_code: null,
  }
  const validStateRow: MonitorStateRow = {
    monitor_id: 'blog',
    level: 'operational',
    consecutive_failures: 0,
    consecutive_successes: 0,
    first_failed_at: null,
    latest_checked_at: 1000,
    latest_success: 1,
    latest_http_status: 200,
    latest_status_text: 'OK',
    latest_response_ms: 42,
    latest_location: 'sfo',
    latest_error_code: null,
  }
  const validSummaryRow: DailySummaryRow = {
    monitor_id: 'blog',
    day: '2026-08-05',
    location: 'sfo',
    check_count: 1,
    failed_check_count: 0,
    response_time_sum: 42,
    response_count: 1,
    highest_severity: 'operational',
  }
  const validIncidentRow: IncidentRow = {
    id: 'blog:1000',
    monitor_id: 'blog',
    first_failed_at: 1000,
    degraded_at: 2000,
    outage_at: null,
    recovered_at: null,
    highest_severity: 'degraded',
  }

  it('maps valid rows to domain-shaped values', () => {
    expect(checkResultFromRow(validCheckRow)).toEqual({
      monitorId: 'blog',
      checkedAt: 1000,
      success: true,
      httpStatus: 200,
      statusText: 'OK',
      responseMs: 42,
      location: 'sfo',
      errorCode: null,
    })
    expect(monitorStateFromRow(validStateRow).latest.success).toBe(true)
    expect(dailySummaryFromRow(validSummaryRow)).toEqual({
      monitorId: 'blog',
      day: '2026-08-05',
      location: 'sfo',
      checkCount: 1,
      failedCheckCount: 0,
      responseTimeSum: 42,
      responseCount: 1,
      highestSeverity: 'operational',
    })
    expect(incidentFromRow(validIncidentRow).highestSeverity).toBe('degraded')
  })

  it('rejects impossible database boolean and enum values', () => {
    expect(() =>
      checkResultFromRow({
        ...validCheckRow,
        success: 2,
      } as unknown as CheckResultRow),
    ).toThrow(/success/)
    expect(() =>
      monitorStateFromRow({
        ...validStateRow,
        level: 'green',
      } as unknown as MonitorStateRow),
    ).toThrow(/level/)
    expect(() =>
      monitorStateFromRow({
        ...validStateRow,
        latest_success: -1,
      } as unknown as MonitorStateRow),
    ).toThrow(/latest_success/)
    expect(() =>
      dailySummaryFromRow({
        ...validSummaryRow,
        highest_severity: 'critical',
      } as unknown as DailySummaryRow),
    ).toThrow(/highest_severity/)
    expect(() =>
      incidentFromRow({
        ...validIncidentRow,
        highest_severity: 'operational',
      } as unknown as IncidentRow),
    ).toThrow(/highest_severity/)
    expect(() =>
      checkResultFromRow({
        ...validCheckRow,
        error_code: 'http',
      } as unknown as CheckResultRow),
    ).toThrow(/error_code/)
  })
})

describe('retention and bounded reads', () => {
  it('deletes only raw checks strictly before the cutoff', async () => {
    for (const checkedAt of [999, 1000, 1001]) {
      await persistCheckBatch(env.DB, [
        persisted(null, result(checkedAt, { monitorId: `m-${checkedAt}` })),
      ])
    }

    await expect(deleteExpiredChecks(env.DB, 1000)).resolves.toBe(1)
    expect(
      await rows('SELECT checked_at FROM check_results ORDER BY checked_at'),
    ).toEqual([{ checked_at: 1000 }, { checked_at: 1001 }])
  })

  it('bounds state and summary reads by monitor IDs and inclusive day', async () => {
    const blog = persisted(
      null,
      result(Date.UTC(2026, 7, 5), { monitorId: 'blog' }),
    )
    const vaultOld = persisted(
      null,
      result(Date.UTC(2026, 7, 4), { monitorId: 'vault' }),
    )
    const vaultNew = persisted(
      vaultOld.transition.next,
      result(Date.UTC(2026, 7, 5), { monitorId: 'vault' }),
    )
    await persistCheckBatch(env.DB, [blog, vaultOld])
    await persistCheckBatch(env.DB, [vaultNew])

    expect(await readCurrentStates(env.DB, ['blog'])).toEqual([
      blog.transition.next,
    ])
    expect(await readCurrentStates(env.DB, [])).toEqual([])
    expect(
      await readDailySummariesSince(env.DB, ['vault'], '2026-08-05'),
    ).toEqual([
      {
        monitorId: 'vault',
        day: '2026-08-05',
        location: 'sfo',
        checkCount: 1,
        failedCheckCount: 0,
        responseTimeSum: 40,
        responseCount: 1,
        highestSeverity: 'operational',
      },
    ])
    expect(await readDailySummariesSince(env.DB, [], '2026-08-05')).toEqual([])
  })

  it('returns only incidents for selected monitors that overlap the inclusive time window', async () => {
    const insert = env.DB.prepare(`INSERT INTO incidents
      (id, monitor_id, first_failed_at, degraded_at, outage_at, recovered_at, highest_severity)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    await env.DB.batch([
      insert.bind('old', 'blog', 100, 110, null, 199, 'degraded'),
      insert.bind('left-edge', 'blog', 100, 110, null, 200, 'degraded'),
      insert.bind('active', 'blog', 250, 260, 300, null, 'outage'),
      insert.bind('right-edge', 'blog', 400, 400, null, null, 'degraded'),
      insert.bind('future', 'blog', 401, 401, null, null, 'degraded'),
      insert.bind('other', 'vault', 250, 250, null, null, 'degraded'),
    ])

    expect(await readIncidentsOverlapping(env.DB, ['blog'], 200, 400)).toEqual([
      {
        id: 'right-edge',
        monitorId: 'blog',
        firstFailedAt: 400,
        degradedAt: 400,
        outageAt: null,
        recoveredAt: null,
        highestSeverity: 'degraded',
      },
      {
        id: 'active',
        monitorId: 'blog',
        firstFailedAt: 250,
        degradedAt: 260,
        outageAt: 300,
        recoveredAt: null,
        highestSeverity: 'outage',
      },
      {
        id: 'left-edge',
        monitorId: 'blog',
        firstFailedAt: 100,
        degradedAt: 110,
        outageAt: null,
        recoveredAt: 200,
        highestSeverity: 'degraded',
      },
    ])
    expect(await readIncidentsOverlapping(env.DB, [], 200, 400)).toEqual([])
  })
})
