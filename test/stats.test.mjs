// M2 tests: aggregation is pure, so every case here is a hand-written fixture
// with a fixed clock. No files, no DSH, no sleeping.
import test from 'node:test'
import assert from 'node:assert/strict'

import { aggregateSessions, dayKey, readUsage } from '../lib/stats.mjs'

const at = (iso) => Date.parse(iso)
const NOW = at('2026-01-03T04:00:00Z') // 2026-01-03 12:00 Beijing

function usageEvent(iso, usage, model) {
  return {
    type: 'assistant/message',
    time: at(iso),
    data: {
      usage,
      message: model ? { source: { kind: 'model', model } } : {},
    },
  }
}

function session(events, extra = {}) {
  return {
    sessionId: 'session-a',
    events: [{ type: 'session', id: 'session-a', createdAt: at('2026-01-01T02:00:00Z') }, ...events],
    badLines: 0,
    ...extra,
  }
}

test('dayKey uses the Beijing day boundary', () => {
  assert.equal(dayKey(at('2026-01-01T15:59:59Z')), '2026-01-01')
  assert.equal(dayKey(at('2026-01-01T16:00:00Z')), '2026-01-02')
})

test('readUsage trusts totalTokens and never double counts reasoning', () => {
  const withTotal = readUsage({
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 3,
    cacheWriteTokens: 2,
    reasoningTokens: 4,
    totalTokens: 20,
  })
  assert.deepEqual(withTotal, { total: 20, input: 10, output: 5, cacheRead: 3, cacheWrite: 2, reasoning: 4 })

  const withoutTotal = readUsage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 })
  assert.equal(withoutTotal.total, 20)
  assert.equal(readUsage(null), null)
})

test('aggregates per day and falls back to the request model', () => {
  const report = aggregateSessions(
    [
      session([
        { type: 'request/context', time: at('2026-01-01T02:00:01Z'), data: { model: 'fallback-model' } },
        usageEvent('2026-01-01T04:00:00Z', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, totalTokens: 35 }, 'model-one'),
        usageEvent('2026-01-02T01:00:00Z', { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      ]),
    ],
    { now: NOW },
  )

  assert.equal(report.totals.tokens, 37)
  assert.equal(report.totals.sessions, 1)
  assert.equal(report.totals.usageSessions, 1)
  assert.deepEqual(Object.keys(report.days), ['2026-01-01', '2026-01-02'])
  assert.equal(report.days['2026-01-01'].tokens, 35)
  assert.deepEqual(report.days['2026-01-01'].models, { 'model-one': 35 })
  assert.deepEqual(report.days['2026-01-02'].models, { 'fallback-model': 2 })
  assert.deepEqual(
    report.models.map((m) => [m.model, m.tokens]),
    [
      ['model-one', 35],
      ['fallback-model', 2],
    ],
  )
  assert.equal(report.range.firstDay, '2026-01-01')
  assert.equal(report.range.lastDay, '2026-01-02')
  assert.equal(report.range.activeDays, 2)
})

test('counts turns, steps, tools, effort and the longest turn', () => {
  const start = at('2026-01-01T04:00:00Z')
  const report = aggregateSessions(
    [
      session([
        { type: 'request/header', time: start, data: { header: { config: { reasoningEffort: 'max' } } } },
        { type: 'turn/start', time: start, data: { turn: 1 } },
        { type: 'step/start', time: start + 1000, data: { turn: 1, step: 1 } },
        { type: 'tool/call', time: start + 2000, data: { name: 'bash' } },
        { type: 'tool/call', time: start + 3000, data: { name: 'bash' } },
        { type: 'tool/call', time: start + 4000, data: { name: 'read' } },
        { type: 'turn/end', time: start + 60_000, data: { turn: 1 } },
        { type: 'turn/start', time: start + 120_000, data: { turn: 2 } },
      ]),
    ],
    { now: NOW },
  )

  assert.equal(report.totals.turns, 2)
  assert.equal(report.totals.steps, 1)
  assert.equal(report.insights.longestTurn.ms, 60_000)
  assert.equal(report.insights.longestTurn.turn, 1)
  assert.deepEqual(
    report.insights.reasoning.map((r) => [r.effort, r.requests]),
    [['max', 1]],
  )
  assert.deepEqual(
    report.insights.tools.map((t) => [t.name, t.calls]),
    [
      ['bash', 2],
      ['read', 1],
    ],
  )
  assert.equal(report.insights.tools[0].share, 2 / 3)
})

test('streaks count consecutive active days and survive a quiet midnight', () => {
  const events = [
    usageEvent('2026-01-01T04:00:00Z', { inputTokens: 1, totalTokens: 1 }),
    usageEvent('2026-01-02T04:00:00Z', { inputTokens: 1, totalTokens: 1 }),
    usageEvent('2026-01-03T04:00:00Z', { inputTokens: 1, totalTokens: 1 }),
  ]

  const whileActive = aggregateSessions([session(events)], { now: NOW })
  assert.deepEqual(whileActive.insights.streak.longest, { days: 3, from: '2026-01-01', to: '2026-01-03' })
  assert.deepEqual(whileActive.insights.streak.current, { days: 3, from: '2026-01-01', to: '2026-01-03' })

  // Just after midnight on Jan 4: nothing recorded yet, streak must not reset.
  const justAfterMidnight = aggregateSessions([session(events)], { now: at('2026-01-03T16:05:00Z') })
  assert.deepEqual(justAfterMidnight.insights.streak.current, { days: 3, from: '2026-01-01', to: '2026-01-03' })

  // Two quiet days later the streak is over.
  const twoDaysLater = aggregateSessions([session(events)], { now: at('2026-01-05T04:00:00Z') })
  assert.equal(twoDaysLater.insights.streak.current.days, 0)
  assert.equal(twoDaysLater.insights.peakDay.tokens, 1)
})

test('an empty history produces a zeroed report, not NaN', () => {
  const report = aggregateSessions([], { now: NOW })
  assert.equal(report.totals.tokens, 0)
  assert.equal(report.totals.sessions, 0)
  assert.equal(report.insights.peakDay, null)
  assert.equal(report.insights.longestTurn, null)
  assert.deepEqual(report.insights.streak.current, { days: 0, from: null, to: null })
  assert.deepEqual(report.insights.reasoning, [])
  assert.deepEqual(report.models, [])
  assert.equal(report.range.firstDay, null)
})
