// dsh-usage — host half.
// 设计说明：docs/modules/index.md
//
// Two read-only routes:
//   GET /dsh-usage/ping          "the plugin is loaded"
//   GET /dsh-usage/stats.json    aggregated usage report
// Keeping a ping route means a broken stats chain is easy to tell apart from a
// plugin that never loaded at all.
import { readFileSync } from 'node:fs'

import { createStatsService } from './service.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export const PLUGIN_NAME = 'dsh-usage'
export const PING_PATH = '/dsh-usage/ping'
export const STATS_PATH = '/dsh-usage/stats.json'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // Usage numbers change constantly; a cached copy would only confuse.
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

// Cordis activates apply() only once every listed service is available.
export const inject = ['webServer']

function sendJson(res, status, data) {
  try {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(data))
  } catch {
    // The socket may already be gone (client aborted); nothing to report.
  }
}

/** Build the ping handler. Exported so tests can call it without DSH. */
export function createPingHandler() {
  return function pingHandler(req, res) {
    sendJson(res, 200, {
      ok: true,
      name: PLUGIN_NAME,
      version: pkg.version,
      time: new Date().toISOString(),
    })
  }
}

/**
 * Build the stats handler.
 *
 * `?refresh=1` bypasses the cache. Failures answer 500 with ok:false so the
 * client can show a real error state instead of an empty page.
 */
export function createStatsHandler(service) {
  return async function statsHandler(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const force = url.searchParams.get('refresh') === '1'
    try {
      sendJson(res, 200, await service.getStats({ force }))
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error?.message ?? error),
        updatedAt: new Date().toISOString(),
      })
    }
  }
}

/**
 * Plugin entry point.
 *
 * ctx.effect(fn) runs fn now and remembers what it returns as the cleanup.
 * webServer.register returns a disposer, so both routes disappear when the
 * plugin is disabled or hot-reloaded — no stale handlers survive a reload.
 */
export function apply(ctx) {
  const service = createStatsService()

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: PING_PATH,
      handler: createPingHandler(),
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: STATS_PATH,
      handler: createStatsHandler(service),
    }),
  )
}
