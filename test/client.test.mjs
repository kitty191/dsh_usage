// Client bundle tests: the bundle is a plain script, so we evaluate it in a
// bare vm context and drive the component with a tiny hook harness.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function createElement(type, props, ...children) {
  return { type, props, children }
}

function createHookHarness() {
  const states = []
  let effects = []
  let index = 0
  return {
    React: {
      createElement,
      useState(initial) {
        const slot = index++
        if (states[slot] === undefined) states[slot] = initial
        return [
          states[slot],
          (next) => {
            states[slot] = typeof next === 'function' ? next(states[slot]) : next
          },
        ]
      },
      useEffect(fn) {
        effects[index++] = fn
      },
    },
    render(component) {
      index = 0
      effects = []
      return component()
    },
    runEffects() {
      const pending = effects
      effects = []
      for (const fn of pending) if (fn) fn()
    },
  }
}

function loadBundle(fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })) {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let definition = null
  const window = { __ModuleLoader__: { load(value) { definition = value } } }
  vm.runInNewContext(code, { window, fetch: fetchImpl })
  return definition
}

function evaluateFactory(definition, react = { createElement, useState: (v) => [v, () => {}], useEffect: () => {} }) {
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

function collect(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, predicate, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) collect(child, predicate, out)
  return out
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const baseBody = {
  ok: true,
  updatedAt: '2026-10-22T13:46:45.656Z',
  totals: { tokens: 1234567, sessions: 3, turns: 12, steps: 34 },
  days: {},
  models: [{ model: 'deepseek-flash', tokens: 1234567 }],
  insights: {
    peakDay: { day: '2026-10-18', tokens: 48073103 },
    longestTurn: { ms: 1384000, sessionId: 'session-a', turn: 2, startedAt: 0, endedAt: 1 },
    streak: {
      longest: { days: 8, from: '2026-10-15', to: '2026-10-22' },
      current: { days: 2, from: '2026-10-21', to: '2026-10-22' },
    },
    reasoning: [{ effort: 'max', requests: 10, share: 1 }],
    tools: [{ name: 'run_code', calls: 42, share: 0.8 }],
  },
}

async function renderReady(body = baseBody) {
  const harness = createHookHarness()
  const definition = loadBundle(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }))
  const exportsObj = evaluateFactory(definition, harness.React)
  harness.render(exportsObj.UsageSection)
  harness.runEffects()
  await settle()
  return { harness, exportsObj, ready: harness.render(exportsObj.UsageSection) }
}

test('bundle registers a factory under the package id', () => {
  const definition = loadBundle()
  assert.equal(definition.id, 'dsh-usage')
  assert.equal(typeof definition.factory, 'function')
})

test('factory exports the client plugin shape', () => {
  const exportsObj = evaluateFactory(loadBundle())
  assert.equal(exportsObj.inject.length, 1)
  assert.equal(exportsObj.inject[0], 'slots')
  assert.equal(typeof exportsObj.apply, 'function')
  assert.equal(typeof exportsObj.UsageSection, 'function')
  assert.equal(typeof exportsObj.buildHeatmap, 'function')
  assert.equal(typeof exportsObj.heatLevel, 'function')
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
  const harness = createHookHarness()
  const exportsObj = evaluateFactory(loadBundle(), harness.React)
  const element = harness.render(exportsObj.UsageSection)
  assert.equal(element.props.role, 'status')
})

test('the section renders five cards with formatted values', async () => {
  const { ready } = await renderReady()
  const text = textOf(ready)

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
  assert.match(text, /不含已删除会话/)
})

test('the insights list summarises effort, model, counts and tools', async () => {
  const { ready } = await renderReady()
  const text = textOf(ready)

  assert.match(text, /洞察/)
  assert.match(text, /最常用推理强度/)
  assert.match(text, /极高 · 100%/)
  assert.match(text, /常用模型/)
  assert.match(text, /deepseek-flash/)
  assert.match(text, /会话 \/ 轮次 \/ 步数/)
  assert.match(text, /3 \/ 12 \/ 34/)
  assert.match(text, /调用最多的工具/)
  assert.match(text, /run_code · 42 次/)
})

test('the refresh button bypasses the cache', async () => {
  const urls = []
  let tokens = 1234567
  const harness = createHookHarness()
  const definition = loadBundle(async (url) => {
    urls.push(url)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ...baseBody, totals: { ...baseBody.totals, tokens } }),
    }
  })
  const exportsObj = evaluateFactory(definition, harness.React)

  harness.render(exportsObj.UsageSection)
  harness.runEffects()
  await settle()
  assert.equal(urls[0], '/dsh-usage/stats.json')

  const ready = harness.render(exportsObj.UsageSection)
  const refreshButton = collect(ready, (node) => node.type === 'button' && textOf(node) === '刷新')[0]
  assert.ok(refreshButton, 'the refresh button must exist')

  tokens = 7654321
  refreshButton.props.onClick()
  await settle()

  const refreshed = harness.render(exportsObj.UsageSection)
  assert.equal(urls[1], '/dsh-usage/stats.json?refresh=1')
  assert.match(textOf(refreshed), /7,654,321/)
})

test('cards are laid out as two rows, 3 + 2', async () => {
  const { ready } = await renderReady()
  const cards = ready.children[2].children[0]

  assert.equal(cards.length, 5)
  assert.deepEqual(
    Array.from(cards, (card) => card.props.style.gridColumn),
    ['span 2', 'span 2', 'span 2', 'span 3', 'span 3'],
  )
  assert.equal(cards[0].props.style.borderLeft, undefined)
  assert.equal(cards[1].props.style.borderLeft, '1px solid var(--dsw-alias-border-l2)')
  assert.equal(cards[3].props.style.borderLeft, undefined)
})

test('the heatmap renders 12 months of cells and the view tabs', async () => {
  const body = {
    ...baseBody,
    days: {
      '2026-10-18': { tokens: 48073103 },
      '2026-10-19': { tokens: 5000000 },
    },
  }
  const { exportsObj, ready } = await renderReady(body)
  const text = textOf(ready)
  assert.match(text, /Token 活动/)
  assert.match(text, /每天/)
  assert.match(text, /每周/)
  assert.match(text, /累计总量/)

  const heat = exportsObj.buildHeatmap(body, 'daily', exportsObj.beijingKey(Date.now()))
  let renderedDays = 0
  for (const column of heat.columns) {
    for (const cell of column.cells) if (cell) renderedDays++
  }
  const cells = collect(ready, (node) => node.props && node.props.className === 'dshUsageHeat-cell')
  assert.equal(cells.length, renderedDays + 5) // + 5 legend swatches

  const target = cells.find((cell) => String(cell.props['aria-label']).startsWith('2026-10-18'))
  assert.ok(target, 'the 2026-10-18 cell must be rendered')
  assert.equal(target.props['data-level'], 3)
})

test('hovering a cell shows the exact token count', async () => {
  const body = { ...baseBody, days: { '2026-10-18': { tokens: 48073103 } } }
  const { harness, exportsObj, ready } = await renderReady(body)
  const cells = collect(ready, (node) => node.props && String(node.props['aria-label']).startsWith('2026-10-18'))
  assert.equal(cells.length, 1)

  cells[0].props.onMouseEnter({ clientX: 40, clientY: 60 })
  const withTooltip = harness.render(exportsObj.UsageSection)
  assert.match(textOf(withTooltip), /2026-10-18 · 48,073,103 tokens/)

  cells[0].props.onMouseLeave()
  const withoutTooltip = harness.render(exportsObj.UsageSection)
  assert.doesNotMatch(textOf(withoutTooltip), /48,073,103 tokens/)
})

test('heatLevel follows the fixed thresholds', () => {
  const { heatLevel } = evaluateFactory(loadBundle())

  assert.equal(heatLevel(0), 0)
  assert.equal(heatLevel(9999999), 1)
  assert.equal(heatLevel(10000000), 2)
  assert.equal(heatLevel(29999999), 2)
  assert.equal(heatLevel(30000000), 3)
  assert.equal(heatLevel(59999999), 3)
  assert.equal(heatLevel(60000000), 4)
  assert.equal(heatLevel(119999999), 4)
  assert.equal(heatLevel(120000000), 5)

  assert.equal(heatLevel(69999999, { view: 'weekly' }), 1)
  assert.equal(heatLevel(70000000, { view: 'weekly' }), 2)

  assert.equal(heatLevel(200, { view: 'cumulative', total: 1000 }), 1)
  assert.equal(heatLevel(201, { view: 'cumulative', total: 1000 }), 2)
  assert.equal(heatLevel(1000, { view: 'cumulative', total: 1000 }), 5)
})

test('buildHeatmap aggregates weeks and cumulative values', () => {
  const { buildHeatmap } = evaluateFactory(loadBundle())
  const report = {
    days: {
      '2026-10-18': { tokens: 48073103 },
      '2026-10-19': { tokens: 5000000 },
    },
  }
  const todayKey = '2026-10-23'

  const weekly = buildHeatmap(report, 'weekly', todayKey)
  const week = weekly.columns.find((column) => column.key === '2026-10-19')
  assert.equal(week.cell.value, 5000000)
  assert.equal(week.cell.level, 1)

  const cumulative = buildHeatmap(report, 'cumulative', todayKey)
  const day = cumulative.columns
    .flatMap((column) => column.cells)
    .find((cell) => cell && cell.key === '2026-10-19')
  assert.equal(day.display, 53073103)
  assert.equal(cumulative.total, 53073103)
})

test('formatting helpers follow the product rules', () => {
  const exportsObj = evaluateFactory(loadBundle())

  assert.equal(exportsObj.formatTokens(250620928), '250,620,928')
  assert.equal(exportsObj.formatTokens(undefined), '—')
  assert.equal(exportsObj.formatDuration(1384000), '23分4秒')
  assert.equal(exportsObj.formatDuration(60000), '1分')
  assert.equal(exportsObj.formatDuration(3600000), '1小时')
  assert.equal(exportsObj.formatDuration(500), '1秒')
  assert.equal(exportsObj.formatDuration(null), '—')
  assert.equal(exportsObj.formatDayRange({ from: '2026-01-01', to: '2026-01-01' }), '2026-01-01')
  assert.equal(exportsObj.formatDayRange({ from: '2026-01-01', to: '2026-01-02' }), '2026-01-01 → 2026-01-02')
  assert.equal(exportsObj.formatDayRange(null), '暂无')
})

test('a report without insights or days still renders without crashing', async () => {
  const { ready } = await renderReady({
    ok: true,
    updatedAt: '2026-10-22T13:46:45.656Z',
    totals: { tokens: 0, sessions: 0 },
  })
  const text = textOf(ready)
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

  harness.render(exportsObj.UsageSection)
  harness.runEffects()
  await settle()

  const failed = harness.render(exportsObj.UsageSection)
  assert.equal(failed.props.role, 'alert')
  assert.match(textOf(failed), /disk on fire/)
})

test('manifest declares the web client and its entry point', () => {
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-settings'])
  assert.equal(pkg.exports['./client'], './lib/client.js')
})
