// dsh-usage — host half.
// 设计说明：docs/modules/index.md
//
// M0 scope: one read-only route that answers "the plugin is loaded".
// Everything else (session scanning, aggregation, the Settings UI) comes later,
// so that a failure here can only mean one thing: the loading chain is broken.
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export const PLUGIN_NAME = 'dsh-usage'
export const PING_PATH = '/dsh-usage/ping'

// Cordis activates apply() only once every listed service is available.
export const inject = ['webServer']

/**
 * Build the ping handler.
 *
 * Kept as a factory instead of an inline closure so tests can call it directly
 * without booting DSH. It returns a plain (req, res) listener, the same shape
 * every node:http route uses.
 */
export function createPingHandler() {
  return function pingHandler(req, res) {
    const body = JSON.stringify({
      ok: true,
      name: PLUGIN_NAME,
      version: pkg.version,
      time: new Date().toISOString(),
    })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(body)
  }
}

/**
 * Plugin entry point.
 *
 * ctx.effect(fn) runs fn now and remembers what it returns as the cleanup.
 * webServer.register returns a disposer, so the route is removed when the
 * plugin is disabled or hot-reloaded — no stale handlers survive a reload.
 */
export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: PING_PATH,
      handler: createPingHandler(),
    }),
  )
}
