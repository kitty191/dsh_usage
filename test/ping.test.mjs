// Host entry tests: they run without DSH.
// A fake host implements only the two things apply() touches: ctx.webServer
// and ctx.effect. If the plugin ever reaches for another service, these tests
// start failing — which is exactly the signal we want.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  apply,
  createPingHandler,
  createStatsHandler,
  inject,
  PING_PATH,
  STATS_PATH,
} from '../lib/index.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function createFakeHost() {
  const routes = []
  const cleanups = []
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    effect(fn) {
      cleanups.push(fn())
    },
  }
  return { ctx, routes, cleanups }
}

function createFakeResponse() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
}

test('declares the webServer dependency', () => {
  assert.deepEqual(inject, ['webServer'])
})

test('registers exact routes for ping and stats', () => {
  const { ctx, routes } = createFakeHost()
  apply(ctx)

  assert.equal(routes.length, 2)
  for (const route of routes) {
    assert.equal(route.kind, 'exact')
    assert.equal(typeof route.handler, 'function')
  }
  assert.deepEqual(routes.map((route) => route.path).sort(), [PING_PATH, STATS_PATH].sort())
})

test('ping handler answers 200 with plugin identity', () => {
  const res = createFakeResponse()
  createPingHandler()({}, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')

  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.name, 'dsh-usage')
  assert.equal(body.version, pkg.version)
  assert.ok(!Number.isNaN(Date.parse(body.time)), 'time must be a valid ISO timestamp')
})

test('stats handler answers 200 and forwards the refresh flag', async () => {
  const seen = []
  const service = {
    async getStats(options) {
      seen.push(options)
      return { ok: true, totals: { tokens: 42 } }
    },
  }
  const handler = createStatsHandler(service)

  const plain = createFakeResponse()
  await handler({ url: STATS_PATH }, plain)
  assert.equal(plain.statusCode, 200)
  assert.equal(JSON.parse(plain.body).totals.tokens, 42)

  const forced = createFakeResponse()
  await handler({ url: `${STATS_PATH}?refresh=1` }, forced)
  assert.equal(forced.statusCode, 200)

  assert.deepEqual(seen, [{ force: false }, { force: true }])
})

test('stats handler turns a failure into 500 with ok:false', async () => {
  const service = {
    async getStats() {
      throw new Error('disk on fire')
    },
  }
  const res = createFakeResponse()
  await createStatsHandler(service)({ url: STATS_PATH }, res)

  assert.equal(res.statusCode, 500)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, false)
  assert.equal(body.error, 'disk on fire')
  assert.ok(!Number.isNaN(Date.parse(body.updatedAt)))
})

test('disposing the effects removes both routes', () => {
  const { ctx, routes, cleanups } = createFakeHost()
  apply(ctx)
  assert.equal(routes.length, 2)
  assert.equal(cleanups.length, 2)

  for (const cleanup of cleanups) cleanup()
  assert.equal(routes.length, 0)
})
