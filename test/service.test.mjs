// M3 tests: cache behaviour without any real file or HTTP.
import test from 'node:test'
import assert from 'node:assert/strict'

import { createStatsService } from '../lib/service.mjs'

const emptyScan = async () => ({ sessions: [], errors: [] })
const minimalReport = { totals: { tokens: 1 }, meta: { events: 0 } }

test('serves a fresh cache instead of scanning again', async () => {
  let calls = 0
  const service = createStatsService({
    now: () => 1_000,
    scan: async () => {
      calls++
      return { sessions: [], errors: [] }
    },
    aggregate: () => minimalReport,
  })

  const first = await service.getStats()
  const second = await service.getStats()

  assert.equal(calls, 1)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(second.totals.tokens, 1)
  assert.equal(first.ok, true)
  assert.ok(!Number.isNaN(Date.parse(first.updatedAt)))
  assert.equal(typeof first.durationMs, 'number')
})

test('refresh bypasses the cache', async () => {
  let calls = 0
  const service = createStatsService({
    now: () => 1_000,
    scan: async () => {
      calls++
      return { sessions: [], errors: [] }
    },
    aggregate: () => minimalReport,
  })

  await service.getStats()
  await service.getStats({ force: true })
  assert.equal(calls, 2)
})

test('rescan after the ttl expires', async () => {
  let clock = 0
  let calls = 0
  const service = createStatsService({
    ttlMs: 1_000,
    now: () => clock,
    scan: async () => {
      calls++
      return { sessions: [], errors: [] }
    },
    aggregate: () => minimalReport,
  })

  await service.getStats()
  clock = 500
  await service.getStats()
  assert.equal(calls, 1)

  clock = 1_001
  await service.getStats()
  assert.equal(calls, 2)
})

test('concurrent callers share one scan', async () => {
  let calls = 0
  let resolveScan
  const service = createStatsService({
    now: () => 1_000,
    scan: () => {
      calls++
      return new Promise((resolve) => {
        resolveScan = () => resolve({ sessions: [], errors: [] })
      })
    },
    aggregate: () => minimalReport,
  })

  const first = service.getStats()
  const second = service.getStats()
  resolveScan()
  const [a, b] = await Promise.all([first, second])

  assert.equal(calls, 1)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
})

test('scan problems are reported, not hidden', async () => {
  const service = createStatsService({
    now: () => 1_000,
    scan: async () => ({ sessions: [], errors: [{ path: '/x', message: 'boom' }] }),
    aggregate: () => minimalReport,
  })

  const payload = await service.getStats()
  assert.equal(payload.meta.errors.length, 1)
  assert.equal(payload.meta.errors[0].message, 'boom')
})

test('a failed scan does not poison the next call', async () => {
  let calls = 0
  const service = createStatsService({
    now: () => 1_000,
    scan: async () => {
      calls++
      if (calls === 1) throw new Error('temporary')
      return { sessions: [], errors: [] }
    },
    aggregate: () => minimalReport,
  })

  await assert.rejects(service.getStats(), /temporary/)
  const recovered = await service.getStats()
  assert.equal(recovered.ok, true)
  assert.equal(calls, 2)
})

test('invalidate forces the next call to rescan', async () => {
  let calls = 0
  const service = createStatsService({
    now: () => 1_000,
    scan: async () => {
      calls++
      return { sessions: [], errors: [] }
    },
    aggregate: () => minimalReport,
  })

  await service.getStats()
  service.invalidate()
  const payload = await service.getStats()

  assert.equal(calls, 2)
  assert.equal(payload.cached, false)
})
