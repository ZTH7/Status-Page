import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildMigrationStatements,
  convertLegacyState,
  parseLegacyState,
  runMigration,
  runMigrationCli,
  type D1Query,
  type LegacySummaryRow,
} from '../../scripts/migrate-legacy-kv'

const fixtureText = readFileSync('tests/fixtures/legacy-kv.json', 'utf8')
const migrationSchema = readFileSync('migrations/0001_initial.sql', 'utf8')
const credentials = {
  CF_ACCOUNT_ID: 'account-id',
  CF_API_TOKEN: 'test-token',
  KV_NAMESPACE_ID: 'namespace-id',
  D1_DATABASE_ID: 'database-id',
}
const configuredMonitorIds = ['blog', 'vault', 'tools', 'alist']
const fixedNow = () => new Date('2026-08-05T14:30:25.123Z')

interface StoredSummaryRow {
  monitor_id: string
  day: string
  location: string
  check_count: number
  failed_check_count: number
  response_time_sum: number
  response_count: number
  highest_severity: string
}

interface FakeCloudflareOptions {
  mutateVerificationRow?: (row: StoredSummaryRow) => unknown
  malformedD1Payload?: unknown
  verificationRowCopies?: number
}

function compositeKey(
  monitorId: string,
  day: string,
  location: string,
): string {
  return `${monitorId}\u0000${day}\u0000${location}`
}

function cloudflareFake(
  rawJson: () => string = () => fixtureText,
  options: FakeCloudflareOptions = {},
) {
  const requests: Array<{
    url: string
    method: string
    authorization: string | null
    contentType: string | null
  }> = []
  const d1Batches: D1Query[][] = []
  const rows = new Map<string, StoredSummaryRow>()

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    const authorization = headers.get('Authorization')
    const contentType = headers.get('Content-Type')
    requests.push({ url, method, authorization, contentType })

    if (url.includes('/storage/kv/namespaces/')) {
      if (
        url !==
          'https://api.cloudflare.com/client/v4/accounts/account-id/storage/kv/namespaces/namespace-id/values/monitors_data_v1_1' ||
        method !== 'GET' ||
        authorization !== 'Bearer test-token'
      ) {
        return new Response('unexpected KV request', { status: 400 })
      }
      return new Response(rawJson(), { status: 200 })
    }

    if (url.includes('/d1/database/')) {
      if (
        url !==
          'https://api.cloudflare.com/client/v4/accounts/account-id/d1/database/database-id/query' ||
        method !== 'POST' ||
        authorization !== 'Bearer test-token' ||
        typeof init?.body !== 'string'
      ) {
        return new Response('unexpected D1 request', { status: 400 })
      }

      const batch = JSON.parse(init.body) as D1Query[]
      d1Batches.push(batch)

      if (options.malformedD1Payload !== undefined) {
        return Response.json(options.malformedD1Payload)
      }

      const result = batch.map((query) => {
        if (/^\s*INSERT INTO daily_summaries/i.test(query.sql)) {
          const [
            monitorId,
            day,
            location,
            checkCount,
            failedCheckCount,
            responseTimeSum,
            responseCount,
            highestSeverity,
          ] = query.params as [
            string,
            string,
            string,
            number,
            number,
            number,
            number,
            string,
          ]
          rows.set(compositeKey(monitorId, day, location), {
            monitor_id: monitorId,
            day,
            location,
            check_count: checkCount,
            failed_check_count: failedCheckCount,
            response_time_sum: responseTimeSum,
            response_count: responseCount,
            highest_severity: highestSeverity,
          })
          return { success: true, results: [], meta: { changes: 1 } }
        }

        if (/^\s*SELECT/i.test(query.sql)) {
          const [monitorId, day, location] = query.params as [
            string,
            string,
            string,
          ]
          const row = rows.get(compositeKey(monitorId, day, location))
          const verificationRow = row
            ? options.mutateVerificationRow
              ? options.mutateVerificationRow({ ...row })
              : row
            : undefined
          return {
            success: true,
            results:
              verificationRow === undefined
                ? []
                : Array.from(
                    { length: options.verificationRowCopies ?? 1 },
                    () => verificationRow,
                  ),
            meta: { changes: 0 },
          }
        }

        return { success: false, results: [], meta: { changes: 0 } }
      })

      return Response.json({ success: true, errors: [], messages: [], result })
    }

    return new Response('unexpected request', { status: 404 })
  }) as typeof fetch

  return { fetch: fakeFetch, requests, d1Batches, rows }
}

function validInput(): Record<string, unknown> {
  return structuredClone(JSON.parse(fixtureText)) as Record<string, unknown>
}

function monitor(
  input: Record<string, unknown>,
  id = 'blog',
): Record<string, unknown> {
  return (input.monitors as Record<string, Record<string, unknown>>)[id]!
}

function check(
  input: Record<string, unknown>,
  day = '2026-08-01',
  id = 'blog',
): Record<string, unknown> {
  return (monitor(input, id).checks as Record<string, Record<string, unknown>>)[
    day
  ]!
}

function location(
  input: Record<string, unknown>,
  pop = 'SIN',
  day = '2026-08-01',
  id = 'blog',
): Record<string, unknown> {
  return (check(input, day, id).res as Record<string, Record<string, unknown>>)[
    pop
  ]!
}

function backupRecorder() {
  const writes: Array<{ path: string; content: string }> = []
  return {
    writes,
    writeBackup: async (path: string, content: string) => {
      writes.push({ path, content })
    },
  }
}

const minimalAggregateJson = '{"n":1,"ms":10,"a":10}'
const minimalDayJson = `{"fails":0,"res":{"SIN":${minimalAggregateJson}}}`
const minimalMonitorJson = `{"firstCheck":"2026-08-01","lastCheck":{},"checks":{"2026-08-01":${minimalDayJson}}}`

function rawLegacyJson(monitorsBody: string): string {
  return `{"monitors":{${monitorsBody}}}`
}

function d1FailureFetch(
  respondToD1: (batch: D1Query[]) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (url.includes('/storage/kv/namespaces/')) {
      return new Response(fixtureText, { status: 200 })
    }
    if (url.includes('/d1/database/') && typeof init?.body === 'string') {
      return respondToD1(JSON.parse(init.body) as D1Query[])
    }
    return new Response('unexpected request', { status: 404 })
  }) as typeof fetch
}

describe('parseLegacyState', () => {
  it.each([
    ['null root', null],
    ['array root', []],
    ['null monitors', { monitors: null }],
    ['array monitors', { monitors: [] }],
  ])('rejects a non-object %s', (_name, input) => {
    expect(() => parseLegacyState(input)).toThrow(/object/i)
  })

  it.each([
    [
      'invalid firstCheck',
      (input: Record<string, unknown>) =>
        (monitor(input).firstCheck = '2026-02-30'),
    ],
    [
      'invalid check date',
      (input: Record<string, unknown>) => {
        const checks = monitor(input).checks as Record<string, unknown>
        checks['2026-02-30'] = checks['2026-08-01']
      },
    ],
    [
      'non-object lastCheck',
      (input: Record<string, unknown>) => (monitor(input).lastCheck = null),
    ],
    [
      'invalid lastCheck status',
      (input: Record<string, unknown>) => {
        ;(monitor(input).lastCheck as Record<string, unknown>).status = 200.5
      },
    ],
    [
      'invalid lastUpdate time',
      (input: Record<string, unknown>) => {
        ;(input.lastUpdate as Record<string, unknown>).time = -1
      },
    ],
    [
      'invalid lastUpdate location',
      (input: Record<string, unknown>) => {
        ;(input.lastUpdate as Record<string, unknown>).loc = 123
      },
    ],
    [
      'non-object day',
      (input: Record<string, unknown>) => {
        ;(monitor(input).checks as Record<string, unknown>)['2026-08-01'] = []
      },
    ],
    [
      'non-object res',
      (input: Record<string, unknown>) => (check(input).res = []),
    ],
  ])('rejects %s', (_name, mutate) => {
    const input = validInput()
    mutate(input)
    expect(() => parseLegacyState(input)).toThrow()
  })

  it.each([
    [
      'negative fails',
      (input: Record<string, unknown>) => (check(input).fails = -1),
    ],
    [
      'fractional fails',
      (input: Record<string, unknown>) => (check(input).fails = 0.5),
    ],
    [
      'non-finite fails',
      (input: Record<string, unknown>) =>
        (check(input).fails = Number.POSITIVE_INFINITY),
    ],
    [
      'unsafe fails',
      (input: Record<string, unknown>) =>
        (check(input).fails = Number.MAX_SAFE_INTEGER + 1),
    ],
    [
      'negative n',
      (input: Record<string, unknown>) => (location(input).n = -1),
    ],
    [
      'fractional n',
      (input: Record<string, unknown>) => (location(input).n = 1.5),
    ],
    [
      'non-finite n',
      (input: Record<string, unknown>) => (location(input).n = Number.NaN),
    ],
    [
      'unsafe n',
      (input: Record<string, unknown>) =>
        (location(input).n = Number.MAX_SAFE_INTEGER + 1),
    ],
    [
      'negative ms',
      (input: Record<string, unknown>) => (location(input).ms = -1),
    ],
    [
      'non-finite ms',
      (input: Record<string, unknown>) =>
        (location(input).ms = Number.POSITIVE_INFINITY),
    ],
    [
      'unsafe ms',
      (input: Record<string, unknown>) =>
        (location(input).ms = Number.MAX_VALUE),
    ],
    [
      'negative average',
      (input: Record<string, unknown>) => (location(input).a = -1),
    ],
    [
      'non-finite average',
      (input: Record<string, unknown>) => (location(input).a = Number.NaN),
    ],
    [
      'unsafe average',
      (input: Record<string, unknown>) =>
        (location(input).a = Number.MAX_VALUE),
    ],
  ])('rejects %s', (_name, mutate) => {
    const input = validInput()
    mutate(input)
    expect(() => parseLegacyState(input)).toThrow(
      /finite|non-negative|integer/i,
    )
  })

  it('accepts optional historical fields when present data remains safe', () => {
    const input = validInput()
    delete input.lastUpdate
    monitor(input).lastCheck = {}
    delete check(input, '2026-08-02').res
    delete location(input, 'HKG').a
    location(input).ms = 240.5

    expect(() => parseLegacyState(input)).not.toThrow()
  })

  it('rejects a failed day whose response aggregates already reserve the unknown key', () => {
    const input = validInput()
    check(input, '2026-08-02').res = {
      unknown: { n: 1, ms: 125, a: 125 },
    }

    expect(() => parseLegacyState(input)).toThrow(/ambiguous|unknown/i)
  })

  it('rejects prototype-bearing and prototype-keyed records', () => {
    const inheritedRoot = Object.create({ monitors: {} }) as Record<
      string,
      unknown
    >
    expect(() => parseLegacyState(inheritedRoot)).toThrow(
      /object shape|prototype/i,
    )

    const prototypeKey = JSON.parse(
      '{"monitors":{"__proto__":{"firstCheck":"2026-08-01","lastCheck":{},"checks":{}}}}',
    ) as unknown
    expect(() => parseLegacyState(prototypeKey)).toThrow(/unsafe|prototype/i)
  })
})

describe('convertLegacyState', () => {
  it('preserves all monitor summaries in deterministic monitor/day/location order', () => {
    expect(
      convertLegacyState(parseLegacyState(JSON.parse(fixtureText))),
    ).toEqual([
      {
        monitorId: 'blog',
        day: '2026-08-01',
        location: 'HKG',
        checkCount: 1,
        failedCheckCount: 0,
        responseTimeSum: 130,
        responseCount: 1,
        highestSeverity: 'operational',
      },
      {
        monitorId: 'blog',
        day: '2026-08-01',
        location: 'SIN',
        checkCount: 2,
        failedCheckCount: 0,
        responseTimeSum: 240,
        responseCount: 2,
        highestSeverity: 'operational',
      },
      {
        monitorId: 'blog',
        day: '2026-08-02',
        location: 'unknown',
        checkCount: 2,
        failedCheckCount: 2,
        responseTimeSum: 0,
        responseCount: 0,
        highestSeverity: 'degraded',
      },
      {
        monitorId: 'blog',
        day: '2026-08-03',
        location: 'SIN',
        checkCount: 2,
        failedCheckCount: 0,
        responseTimeSum: 250,
        responseCount: 2,
        highestSeverity: 'operational',
      },
      {
        monitorId: 'retired-api',
        day: '2026-08-01',
        location: 'LAX',
        checkCount: 1,
        failedCheckCount: 0,
        responseTimeSum: 210,
        responseCount: 1,
        highestSeverity: 'operational',
      },
      {
        monitorId: 'vault',
        day: '2026-08-01',
        location: 'NRT',
        checkCount: 2,
        failedCheckCount: 0,
        responseTimeSum: 180,
        responseCount: 2,
        highestSeverity: 'operational',
      },
      {
        monitorId: 'vault',
        day: '2026-08-02',
        location: 'NRT',
        checkCount: 1,
        failedCheckCount: 0,
        responseTimeSum: 110,
        responseCount: 1,
        highestSeverity: 'degraded',
      },
      {
        monitorId: 'vault',
        day: '2026-08-02',
        location: 'unknown',
        checkCount: 1,
        failedCheckCount: 1,
        responseTimeSum: 0,
        responseCount: 0,
        highestSeverity: 'degraded',
      },
    ] satisfies LegacySummaryRow[])
  })
})

describe('buildMigrationStatements', () => {
  it('builds deterministic bound replacement UPSERTs that only target daily_summaries', () => {
    const rows = convertLegacyState(parseLegacyState(JSON.parse(fixtureText)))
    const first = buildMigrationStatements(rows)
    const second = buildMigrationStatements(rows)

    expect(second).toEqual(first)
    expect(first[0]?.params).toEqual([
      'blog',
      '2026-08-01',
      'HKG',
      1,
      0,
      130,
      1,
      'operational',
    ])
    expect(
      first.every((query) => query.sql.includes('INSERT INTO daily_summaries')),
    ).toBe(true)
    expect(first.every((query) => query.sql.includes('= excluded.'))).toBe(true)
    expect(first.map((query) => query.sql).join('\n')).not.toMatch(
      /check_results|monitor_state|incidents/i,
    )
  })

  it('executes exact generated UPSERTs twice in SQLite and replaces every aggregate field', () => {
    const firstRows: LegacySummaryRow[] = [
      {
        monitorId: 'blog',
        day: '2026-08-01',
        location: 'SIN',
        checkCount: 2,
        failedCheckCount: 0,
        responseTimeSum: 240,
        responseCount: 2,
        highestSeverity: 'operational',
      },
    ]
    const replacementRows: LegacySummaryRow[] = [
      {
        monitorId: 'blog',
        day: '2026-08-01',
        location: 'SIN',
        checkCount: 9,
        failedCheckCount: 3,
        responseTimeSum: 999,
        responseCount: 6,
        highestSeverity: 'degraded',
      },
    ]
    const sqliteProgram = `
      import { DatabaseSync } from 'node:sqlite'
      let input = ''
      for await (const chunk of process.stdin) input += chunk
      const payload = JSON.parse(input)
      const database = new DatabaseSync(':memory:')
      database.exec(payload.schema)
      for (const queries of [payload.first, payload.second]) {
        for (const query of queries) database.prepare(query.sql).run(...query.params)
      }
      const rows = database.prepare(
        'SELECT monitor_id, day, location, check_count, failed_check_count, response_time_sum, response_count, highest_severity FROM daily_summaries ORDER BY monitor_id, day, location'
      ).all()
      database.close()
      process.stdout.write(JSON.stringify(rows))
    `

    const output = execFileSync(
      process.execPath,
      ['--no-warnings', '--input-type=module', '--eval', sqliteProgram],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          schema: migrationSchema,
          first: buildMigrationStatements(firstRows),
          second: buildMigrationStatements(replacementRows),
        }),
      },
    )

    expect(JSON.parse(output)).toEqual([
      {
        monitor_id: 'blog',
        day: '2026-08-01',
        location: 'SIN',
        check_count: 9,
        failed_check_count: 3,
        response_time_sum: 999,
        response_count: 6,
        highest_severity: 'degraded',
      },
    ])
  })
})

describe('runMigration', () => {
  it('fetches, validates, backs up exact source text, reports configured/removed IDs, and makes no D1 call in dry-run', async () => {
    const cloudflare = cloudflareFake()
    const backup = backupRecorder()
    const output: string[] = []

    const report = await runMigration({
      mode: 'dry-run',
      env: credentials,
      fetch: cloudflare.fetch,
      now: fixedNow,
      writeBackup: backup.writeBackup,
      stdout: (message) => output.push(message),
      configuredMonitorIds,
      backupDirectory: 'migration-backups',
    })

    expect(backup.writes).toEqual([
      {
        path: 'migration-backups/legacy-kv-20260805T143025123Z.json',
        content: fixtureText,
      },
    ])
    expect(report).toMatchObject({
      mode: 'dry-run',
      sourceMonitorIds: ['blog', 'retired-api', 'vault'],
      configuredMonitorIdsPresent: ['blog', 'vault'],
      removedMonitorIds: ['retired-api'],
      dateRange: { first: '2026-08-01', last: '2026-08-04' },
      locations: ['HKG', 'LAX', 'NRT', 'SIN', 'unknown'],
      sourceCheckCount: 12,
      sourceFailureCount: 3,
      d1RowCount: 8,
      verifiedRowCount: 0,
    })
    expect(JSON.parse(output.join(''))).toEqual(report)
    expect(cloudflare.requests).toHaveLength(1)
    expect(cloudflare.d1Batches).toHaveLength(0)
  })

  it.each([
    [
      'monitors member with an escaped-equivalent ID',
      rawLegacyJson(
        `"blog":${minimalMonitorJson},"\\u0062log":${minimalMonitorJson}`,
      ),
    ],
    [
      'checks date member',
      rawLegacyJson(
        `"blog":{"firstCheck":"2026-08-01","lastCheck":{},"checks":{"2026-08-01":${minimalDayJson},"2026-08-01":${minimalDayJson}}}`,
      ),
    ],
    [
      'res location member with an escaped-equivalent PoP',
      rawLegacyJson(
        `"blog":{"firstCheck":"2026-08-01","lastCheck":{},"checks":{"2026-08-01":{"fails":0,"res":{"SIN":${minimalAggregateJson},"\\u0053IN":${minimalAggregateJson}}}}}`,
      ),
    ],
    [
      'known aggregate member with an escaped-equivalent key',
      rawLegacyJson(
        '"blog":{"firstCheck":"2026-08-01","lastCheck":{},"checks":{"2026-08-01":{"fails":0,"res":{"SIN":{"n":1,"\\u006e":2,"ms":10}}}}}',
      ),
    ],
  ])(
    'rejects a duplicate raw JSON %s before backup or D1 access',
    async (_name, rawJson) => {
      const cloudflare = cloudflareFake(() => rawJson)
      const backup = backupRecorder()

      await expect(
        runMigration({
          mode: 'dry-run',
          env: credentials,
          fetch: cloudflare.fetch,
          writeBackup: backup.writeBackup,
          stdout: () => undefined,
          configuredMonitorIds,
        }),
      ).rejects.toThrow(/duplicate|unique|ambiguous/i)
      expect(backup.writes).toHaveLength(0)
      expect(cloudflare.requests).toHaveLength(1)
      expect(cloudflare.d1Batches).toHaveLength(0)
    },
  )

  it.each([
    [
      'failure count across monitors',
      {
        first: {
          firstCheck: '2026-08-01',
          lastCheck: {},
          checks: { '2026-08-01': { fails: Number.MAX_SAFE_INTEGER } },
        },
        second: {
          firstCheck: '2026-08-01',
          lastCheck: {},
          checks: { '2026-08-01': { fails: 1 } },
        },
      },
    ],
    [
      'check count across PoPs',
      {
        first: {
          firstCheck: '2026-08-01',
          lastCheck: {},
          checks: {
            '2026-08-01': {
              fails: 0,
              res: {
                HKG: { n: Number.MAX_SAFE_INTEGER, ms: 0 },
                SIN: { n: 1, ms: 0 },
              },
            },
          },
        },
      },
    ],
  ])(
    'rejects unsafe accumulated source %s before backup or D1 access',
    async (_name, monitors) => {
      const cloudflare = cloudflareFake(() => JSON.stringify({ monitors }))
      const backup = backupRecorder()

      await expect(
        runMigration({
          mode: 'dry-run',
          env: credentials,
          fetch: cloudflare.fetch,
          writeBackup: backup.writeBackup,
          stdout: () => undefined,
          configuredMonitorIds,
        }),
      ).rejects.toThrow(/source.*count|safe/i)
      expect(backup.writes).toHaveLength(0)
      expect(cloudflare.d1Batches).toHaveLength(0)
    },
  )

  it('uses an injected configuration loader when monitor IDs are not supplied', async () => {
    let configLoads = 0
    const cloudflare = cloudflareFake()

    const report = await runMigration({
      mode: 'dry-run',
      env: credentials,
      fetch: cloudflare.fetch,
      writeBackup: async () => undefined,
      stdout: () => undefined,
      loadConfiguredMonitorIds: async () => {
        configLoads += 1
        return ['retired-api']
      },
    })

    expect(configLoads).toBe(1)
    expect(report.configuredMonitorIdsPresent).toEqual(['retired-api'])
    expect(report.removedMonitorIds).toEqual(['blog', 'vault'])
  })

  it('requires all credentials before config, backup, or network work and lists every missing name', async () => {
    let fetched = false
    let backedUp = false
    let configLoaded = false

    await expect(
      runMigration({
        mode: 'dry-run',
        env: {},
        fetch: (async () => {
          fetched = true
          return new Response()
        }) as typeof fetch,
        writeBackup: async () => {
          backedUp = true
        },
        loadConfiguredMonitorIds: async () => {
          configLoaded = true
          throw new Error('config must not load')
        },
      }),
    ).rejects.toThrow(
      /CF_ACCOUNT_ID.*CF_API_TOKEN.*KV_NAMESPACE_ID.*D1_DATABASE_ID/s,
    )
    expect(fetched).toBe(false)
    expect(backedUp).toBe(false)
    expect(configLoaded).toBe(false)
  })

  it('backs up before write, batches at most 100 bound UPSERTs, and verifies every key', async () => {
    const manyLocations = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [
        `POP${String(index).padStart(3, '0')}`,
        { n: 1, ms: index, a: index },
      ]),
    )
    const rawJson = JSON.stringify({
      monitors: {
        blog: {
          firstCheck: '2026-08-01',
          lastCheck: {},
          checks: { '2026-08-01': { fails: 0, res: manyLocations } },
        },
      },
    })
    const events: string[] = []
    const cloudflare = cloudflareFake(() => rawJson)
    const trackingFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      events.push(url.includes('/d1/') ? 'd1' : 'kv')
      return cloudflare.fetch(input, init)
    }) as typeof fetch

    const report = await runMigration({
      mode: 'write',
      env: credentials,
      fetch: trackingFetch,
      now: fixedNow,
      writeBackup: async () => {
        events.push('backup')
      },
      stdout: () => undefined,
      configuredMonitorIds,
    })

    const insertBatches = cloudflare.d1Batches.filter((batch) =>
      batch.every((query) => /^\s*INSERT/i.test(query.sql)),
    )
    const verificationBatches = cloudflare.d1Batches.filter((batch) =>
      batch.every((query) => /^\s*SELECT/i.test(query.sql)),
    )
    expect(events.slice(0, 3)).toEqual(['kv', 'backup', 'd1'])
    expect(insertBatches.map((batch) => batch.length)).toEqual([100, 100, 5])
    expect(verificationBatches.map((batch) => batch.length)).toEqual([
      100, 100, 5,
    ])
    expect(
      cloudflare.d1Batches.flat().every((query) => query.params.length > 0),
    ).toBe(true)
    expect(
      cloudflare.requests
        .filter((request) => request.url.includes('/d1/database/'))
        .every((request) => request.contentType === 'application/json'),
    ).toBe(true)
    expect(
      cloudflare.d1Batches
        .flat()
        .map((query) => query.sql)
        .join('\n'),
    ).not.toMatch(/check_results|monitor_state|incidents/i)
    expect(report).toMatchObject({ d1RowCount: 205, verifiedRowCount: 205 })
  })

  it('repeated writes replace aggregates and keep the verified composite row count stable', async () => {
    let currentRaw = fixtureText
    const cloudflare = cloudflareFake(() => currentRaw)
    const sharedOptions = {
      mode: 'write' as const,
      env: credentials,
      fetch: cloudflare.fetch,
      now: fixedNow,
      writeBackup: async () => undefined,
      stdout: () => undefined,
      configuredMonitorIds,
    }

    const firstReport = await runMigration(sharedOptions)
    const changed = JSON.parse(fixtureText) as Record<string, unknown>
    location(changed, 'HKG').ms = 999
    currentRaw = JSON.stringify(changed)
    const secondReport = await runMigration(sharedOptions)

    expect(firstReport.verifiedRowCount).toBe(8)
    expect(secondReport.verifiedRowCount).toBe(8)
    expect(cloudflare.rows).toHaveLength(8)
    expect(
      cloudflare.rows.get(compositeKey('blog', '2026-08-01', 'HKG')),
    ).toMatchObject({
      response_time_sum: 999,
    })
  })

  it.each([
    [
      'check_count',
      (row: StoredSummaryRow) => ({ ...row, check_count: row.check_count + 1 }),
    ],
    [
      'response_time_sum',
      (row: StoredSummaryRow) => ({
        ...row,
        response_time_sum: row.response_time_sum + 1,
      }),
    ],
    [
      'highest_severity',
      (row: StoredSummaryRow) => ({ ...row, highest_severity: 'outage' }),
    ],
  ])(
    'rejects a verification %s mismatch',
    async (_field, mutateVerificationRow) => {
      const cloudflare = cloudflareFake(() => fixtureText, {
        mutateVerificationRow,
      })

      await expect(
        runMigration({
          mode: 'write',
          env: credentials,
          fetch: cloudflare.fetch,
          now: fixedNow,
          writeBackup: async () => undefined,
          stdout: () => undefined,
          configuredMonitorIds,
        }),
      ).rejects.toThrow(/verification/i)
    },
  )

  it.each([
    ['zero', 0],
    ['duplicate', 2],
  ])(
    'rejects %s rows returned for an expected verification key',
    async (_name, verificationRowCopies) => {
      const cloudflare = cloudflareFake(() => fixtureText, {
        verificationRowCopies,
      })

      await expect(
        runMigration({
          mode: 'write',
          env: credentials,
          fetch: cloudflare.fetch,
          writeBackup: async () => undefined,
          stdout: () => undefined,
          configuredMonitorIds,
        }),
      ).rejects.toThrow(/missing|duplicate|verification/i)
    },
  )

  it('rejects KV non-2xx and invalid JSON responses without creating a backup', async () => {
    for (const response of [
      new Response('forbidden', { status: 403 }),
      new Response('not-json', { status: 200 }),
    ]) {
      let backedUp = false
      await expect(
        runMigration({
          mode: 'dry-run',
          env: credentials,
          fetch: (async () => response.clone()) as typeof fetch,
          writeBackup: async () => {
            backedUp = true
          },
          configuredMonitorIds,
        }),
      ).rejects.toThrow(/legacy KV/i)
      expect(backedUp).toBe(false)
    }
  })

  it.each([
    [
      'Cloudflare failure',
      { success: false, errors: [], messages: [], result: [] },
    ],
    [
      'malformed result',
      { success: true, errors: [], messages: [], result: {} },
    ],
  ])('rejects a %s D1 response safely', async (_name, malformedD1Payload) => {
    const cloudflare = cloudflareFake(() => fixtureText, { malformedD1Payload })
    await expect(
      runMigration({
        mode: 'write',
        env: credentials,
        fetch: cloudflare.fetch,
        writeBackup: async () => undefined,
        stdout: () => undefined,
        configuredMonitorIds,
      }),
    ).rejects.toThrow(/D1/i)
  })

  it.each([
    [
      'network rejection',
      async (_batch: D1Query[]) => {
        throw new Error('test-token SECRET_RESPONSE_BODY')
      },
    ],
    [
      'non-2xx response',
      async (_batch: D1Query[]) =>
        new Response('SECRET_RESPONSE_BODY test-token', { status: 503 }),
    ],
    [
      'invalid JSON response',
      async (_batch: D1Query[]) =>
        new Response('SECRET_RESPONSE_BODY test-token', { status: 200 }),
    ],
    [
      'unsuccessful per-query result',
      async (batch: D1Query[]) =>
        Response.json({
          success: true,
          errors: [{ message: 'SECRET_RESPONSE_BODY test-token' }],
          messages: [],
          result: batch.map(() => ({ success: false, results: [], meta: {} })),
        }),
    ],
    [
      'per-query result missing results',
      async (batch: D1Query[]) =>
        Response.json({
          success: true,
          errors: [{ message: 'SECRET_RESPONSE_BODY test-token' }],
          messages: [],
          result: batch.map(() => ({ success: true, meta: {} })),
        }),
    ],
    [
      'result-list length mismatch',
      async (batch: D1Query[]) =>
        Response.json({
          success: true,
          errors: [{ message: 'SECRET_RESPONSE_BODY test-token' }],
          messages: [],
          result: batch
            .slice(1)
            .map(() => ({ success: true, results: [], meta: {} })),
        }),
    ],
  ])(
    'rejects a D1 %s without exposing credentials or response bodies',
    async (_name, respondToD1) => {
      let failure: unknown
      try {
        await runMigration({
          mode: 'write',
          env: credentials,
          fetch: d1FailureFetch(respondToD1),
          writeBackup: async () => undefined,
          stdout: () => undefined,
          configuredMonitorIds,
        })
      } catch (error) {
        failure = error
      }

      expect(failure).toBeInstanceOf(Error)
      const message = (failure as Error).message
      expect(message).toMatch(/D1/i)
      expect(message).not.toContain('test-token')
      expect(message).not.toContain('SECRET_RESPONSE_BODY')
    },
  )
})

describe('runMigrationCli', () => {
  it.each([
    ['no mode', []],
    ['both modes', ['--dry-run', '--write']],
    ['unknown argument', ['--dry-run', '--surprise']],
  ])('requires exactly one explicit mode for %s', async (_name, args) => {
    let fetched = false
    let backedUp = false
    const errors: string[] = []
    const exitCode = await runMigrationCli(args, {
      env: credentials,
      fetch: (async () => {
        fetched = true
        return new Response()
      }) as typeof fetch,
      writeBackup: async () => {
        backedUp = true
      },
      configuredMonitorIds,
      stderr: (message) => errors.push(message),
    })

    expect(exitCode).toBe(1)
    expect(errors.join('\n')).toMatch(/--dry-run.*--write/s)
    expect(fetched).toBe(false)
    expect(backedUp).toBe(false)
  })

  it('prints every missing credential and exits one without backup or network work', async () => {
    let fetched = false
    let backedUp = false
    const errors: string[] = []
    const exitCode = await runMigrationCli(['--dry-run'], {
      env: {},
      fetch: (async () => {
        fetched = true
        return new Response()
      }) as typeof fetch,
      writeBackup: async () => {
        backedUp = true
      },
      configuredMonitorIds,
      stderr: (message) => errors.push(message),
    })

    expect(exitCode).toBe(1)
    expect(errors.join('\n')).toMatch(
      /CF_ACCOUNT_ID.*CF_API_TOKEN.*KV_NAMESPACE_ID.*D1_DATABASE_ID/s,
    )
    expect(fetched).toBe(false)
    expect(backedUp).toBe(false)
  })
})
