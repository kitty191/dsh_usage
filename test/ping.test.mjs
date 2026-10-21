// M0 tests: they run without DSH.
// A fake host implements only the two things apply() touches: ctx.webServer
// and ctx.effect. If the plugin ever reaches for another service, this test
// starts failing — which is exactly the signal we want.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { apply, inject, PING_PATH, createPingHandler } from '../lib/index.js'

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

test('registers one exact route on the ping path', () => {
  const { ctx, routes } = createFakeHost()
  apply(ctx)

  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, PING_PATH)
  assert.equal(typeof routes[0].handler, 'function')
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

test('disposing the effect removes the route', () => {
  const { ctx, routes, cleanups } = createFakeHost()
  apply(ctx)
  assert.equal(routes.length, 1)

  assert.equal(cleanups.length, 1)
  cleanups[0]()

  assert.equal(routes.length, 0)
})
