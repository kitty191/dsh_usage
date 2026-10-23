// dsh-usage — service layer.
// 设计说明：docs/modules/service.md
//
// The only module that knows both sides: it owns a cache and calls the
// scanning + aggregation layers. Keeping it separate from lib/index.js means
// the HTTP layer stays a thin adapter and the cache is testable without HTTP.
import { aggregateSessions } from './stats.mjs'
import { defaultSessionRoots, scanSessions } from './scan.mjs'

export const DEFAULT_TTL_MS = 60_000

/**
 * Build the stats service.
 *
 * Every dependency is injectable so tests can run without real session files:
 *   scan       async ({ roots }) => { sessions, errors }
 *   aggregate  (sessions, { now }) => report
 *   now        () => ms, the clock used for TTL and for "current streak"
 */
export function createStatsService({
  roots = defaultSessionRoots(),
  scan = scanSessions,
  aggregate = aggregateSessions,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
} = {}) {
  let cached = null
  let inflight = null

  async function build() {
    const startedAt = now()
    const { sessions, errors } = await scan({ roots })
    const report = aggregate(sessions, { now: startedAt })
    const payload = {
      ok: true,
      updatedAt: new Date(startedAt).toISOString(),
      durationMs: Math.max(0, now() - startedAt),
      ...report,
      meta: { ...report.meta, errors },
    }
    cached = { payload, at: startedAt }
    return payload
  }

  /**
   * Return the report, from cache when it is still fresh.
   *
   * A failure never replaces the last good cache entry: the caller sees the
   * error and the next request can succeed without waiting for another scan.
   * Concurrent callers share one in-flight scan instead of piling up.
   */
  async function getStats({ force = false } = {}) {
    if (!force && cached && now() - cached.at < ttlMs) {
      return { ...cached.payload, cached: true }
    }
    if (!inflight) {
      inflight = build().finally(() => {
        inflight = null
      })
    }
    const payload = await inflight
    return { ...payload, cached: false }
  }

  function invalidate() {
    cached = null
  }

  return { getStats, invalidate }
}
