// M4 tests: the client bundle is a plain script, so we can evaluate it in a
// bare vm context and inspect the factory contract without a browser.
//
// The hook harness is deliberately tiny: it only needs to survive two renders
// (loading → ready/error) to prove the component wires fetch into state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function createElement(type, props, ...children) {
  return { type, props, children }
}

function plainReact() {
  return { createElement, useState: (initial) => [initial, () => {}], useEffect: () => {} }
}

function createHookHarness() {
  let state
  let effect
  return {
    React: {
      createElement,
      useState(initial) {
        if (state === undefined) state = initial
        return [state, (next) => { state = typeof next === 'function' ? next(state) : next }]
      },
      useEffect(fn) {
        effect = fn
      },
    },
    runEffect: () => effect?.(),
    getState: () => state,
  }
}

function loadBundle(fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })) {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let definition = null
  const window = { __ModuleLoader__: { load(value) { definition = value } } }
  vm.runInNewContext(code, { window, fetch: fetchImpl })
  return definition
}

function evaluateFactory(definition, react = plainReact()) {
  return definition.factory((name) => {
    if (name === 'react') return react
    throw new Error('unexpected require: ' + name)
  })
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (!node || typeof node !== 'object') return ''
  return (node.children || []).map(textOf).join(' ')
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('bundle registers a factory under the package id', () => {
  const definition = loadBundle()
  assert.equal(definition.id, 'dsh-usage')
  assert.equal(typeof definition.factory, 'function')
})

test('factory exports the client plugin shape', () => {
  const exportsObj = evaluateFactory(loadBundle())
  // The bundle runs in its own vm realm, so compare by value, not by prototype.
  assert.equal(exportsObj.inject.length, 1)
  assert.equal(exportsObj.inject[0], 'slots')
  assert.equal(typeof exportsObj.apply, 'function')
  assert.equal(typeof exportsObj.UsageSection, 'function')
  assert.equal(exportsObj.STATS_URL, '/dsh-usage/stats.json')
})

test('apply registers a usage section and returns a cleanup', () => {
  const exportsObj = evaluateFactory(loadBundle())
  const registered = []
  let cleanup = null
  const ctx = {
    effect(fn) {
      cleanup = fn()
    },
    slots: {
      inject(name, register) {
        assert.equal(name, 'settings.section')
        return register()
      },
      register(definition, component) {
        registered.push({ definition, component })
        return () => {}
      },
    },
  }

  exportsObj.apply(ctx)

  assert.equal(registered.length, 1)
  const { definition, component } = registered[0]
  assert.equal(definition.name, 'settings.section')
  assert.equal(definition.id, 'usage')
  assert.equal(definition.order, 50)
  assert.equal(definition.label(), 'Usage')
  assert.equal(component, exportsObj.UsageSection)
  assert.equal(typeof cleanup, 'function')
})

test('the section renders a loading status first', () => {
  const exportsObj = evaluateFactory(loadBundle())
  const element = exportsObj.UsageSection()
  assert.equal(element.props.role, 'status')
})

test('the section renders five cards with formatted values', async () => {
  const harness = createHookHarness()
  const body = {
    ok: true,
    updatedAt: '2026-10-22T13:46:45.656Z',
    totals: { tokens: 1234567, sessions: 3 },
    insights: {
      peakDay: { day: '2026-10-18', tokens: 48073103 },
      longestTurn: { ms: 1384000, sessionId: 'session-a', turn: 2, startedAt: 0, endedAt: 1 },
      streak: {
        longest: { days: 8, from: '2026-10-15', to: '2026-10-22' },
        current: { days: 2, from: '2026-10-21', to: '2026-10-22' },
      },
    },
  }
  const definition = loadBundle(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }))
  const exportsObj = evaluateFactory(definition, harness.React)

  assert.equal(exportsObj.UsageSection().props.role, 'status')
  harness.runEffect()
  await settle()

  const ready = exportsObj.UsageSection()
  const text = textOf(ready)
  assert.equal(ready.props['data-usage-section'], 'summary')

  for (const label of ['累计 Token', '单日峰值', '最长单轮', '最长连续', '当前连续']) {
    assert.match(text, new RegExp(label))
  }
  assert.match(text, /1,234,567/)
  assert.match(text, /48,073,103/)
  assert.match(text, /2026-10-18/)
  assert.match(text, /23分4秒/)
  assert.match(text, /8 天/)
  assert.match(text, /2026-10-15 → 2026-10-22/)
  assert.match(text, /2 天/)
})

test('cards are laid out as two rows, 3 + 2', async () => {
  const harness = createHookHarness()
  const body = {
    ok: true,
    updatedAt: '2026-10-22T13:46:45.656Z',
    totals: { tokens: 1, sessions: 1 },
    insights: {
      peakDay: null,
      longestTurn: null,
      streak: { longest: { days: 0 }, current: { days: 0 } },
    },
  }
  const definition = loadBundle(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }))
  const exportsObj = evaluateFactory(definition, harness.React)

  exportsObj.UsageSection()
  harness.runEffect()
  await settle()

  const ready = exportsObj.UsageSection()
  const cards = ready.children[1].children[0]

  assert.equal(cards.length, 5)
  // Array.from runs in this realm, so the comparison is not across realms.
  assert.deepEqual(
    Array.from(cards, (card) => card.props.style.gridColumn),
    ['span 2', 'span 2', 'span 2', 'span 3', 'span 3'],
  )
  assert.equal(cards[0].props.style.borderLeft, undefined)
  assert.equal(cards[1].props.style.borderLeft, '1px solid var(--dsw-alias-border-l2)')
  assert.equal(cards[3].props.style.borderLeft, undefined)
  assert.equal(cards[4].props.style.borderLeft, '1px solid var(--dsw-alias-border-l2)')
})

test('formatting helpers follow the product rules', () => {
  const exportsObj = evaluateFactory(loadBundle())

  assert.equal(exportsObj.formatTokens(250620928), '250,620,928')
  assert.equal(exportsObj.formatTokens(undefined), '—')

  assert.equal(exportsObj.formatDuration(1_384_000), '23分4秒')
  assert.equal(exportsObj.formatDuration(60_000), '1分')
  assert.equal(exportsObj.formatDuration(3_600_000), '1小时')
  assert.equal(exportsObj.formatDuration(500), '1秒')
  assert.equal(exportsObj.formatDuration(null), '—')

  assert.equal(exportsObj.formatDayRange({ from: '2026-01-01', to: '2026-01-01' }), '2026-01-01')
  assert.equal(exportsObj.formatDayRange({ from: '2026-01-01', to: '2026-01-02' }), '2026-01-01 → 2026-01-02')
  assert.equal(exportsObj.formatDayRange(null), '暂无')
})

test('a report without insights still renders without crashing', async () => {
  const harness = createHookHarness()
  const definition = loadBundle(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      ok: true,
      updatedAt: '2026-10-22T13:46:45.656Z',
      totals: { tokens: 0, sessions: 0 },
    }),
  }))
  const exportsObj = evaluateFactory(definition, harness.React)

  exportsObj.UsageSection()
  harness.runEffect()
  await settle()

  const ready = exportsObj.UsageSection()
  const text = textOf(ready)
  assert.equal(ready.props['data-usage-section'], 'summary')
  assert.match(text, /0 天/)
  assert.match(text, /—/)
})

test('the section shows the server error instead of a blank page', async () => {
  const harness = createHookHarness()
  const definition = loadBundle(async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ ok: false, error: 'disk on fire' }),
  }))
  const exportsObj = evaluateFactory(definition, harness.React)

  // First render registers the effect; only then is there something to run.
  assert.equal(exportsObj.UsageSection().props.role, 'status')
  harness.runEffect()
  await settle()

  const failed = exportsObj.UsageSection()
  assert.equal(failed.props.role, 'alert')
  assert.match(textOf(failed), /disk on fire/)
})

test('manifest declares the web client and its entry point', () => {
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-settings'])
  assert.equal(pkg.exports['./client'], './lib/client.js')
})
