// dsh-usage — aggregation layer.
//
// Pure functions: events in, numbers out. No file access, no clock reads
// (the caller passes `now` when it matters), no network. That is what makes
// every number here cheap to test with hand-written fixtures.
//
// Token formula (verified against 792 real usage records: 100% agreement):
//   totalTokens === inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
// `reasoningTokens` is already part of outputTokens, so it is reported but
// never added to the total.
const DAY_MS = 86_400_000
const BEIJING_OFFSET_MS = 8 * 3_600_000

/** Calendar day (YYYY-MM-DD) in Beijing time, the boundary DSH itself uses. */
export function dayKey(ms) {
  return new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

function previousDayKey(key) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
}

function num(value) {
  return Number.isFinite(value) ? value : 0
}

/** Normalize one `assistant/message.data.usage` record. */
export function readUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const input = num(usage.inputTokens)
  const output = num(usage.outputTokens)
  const cacheRead = num(usage.cacheReadTokens)
  const cacheWrite = num(usage.cacheWriteTokens)
  const reasoning = num(usage.reasoningTokens)
  const total = Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : input + output + cacheRead + cacheWrite
  return { total, input, output, cacheRead, cacheWrite, reasoning }
}

function emptyDay() {
  return {
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    steps: 0,
    turns: 0,
    sessions: 0,
    usageSessions: 0,
    models: {},
  }
}

function addUsage(target, usage) {
  target.tokens += usage.total
  target.input += usage.input
  target.output += usage.output
  target.cacheRead += usage.cacheRead
  target.cacheWrite += usage.cacheWrite
  target.reasoning += usage.reasoning
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/**
 * Aggregate every session into one report.
 *
 * @param sessions array of { sessionId, events, badLines } from lib/scan.mjs
 * @param options.now injectable clock, used only by the "current streak"
 */
export function aggregateSessions(sessions, { now = Date.now() } = {}) {
  const totals = emptyDay()
  const days = new Map()
  const models = new Map()
  const efforts = new Map()
  const tools = new Map()
  const sessionIds = new Set()
  const usageSessionIds = new Set()
  const turnStarts = new Map()
  let longestTurn = null
  let eventCount = 0
  let badLines = 0

  const dayBucket = (key) => {
    let bucket = days.get(key)
    if (!bucket) {
      bucket = emptyDay()
      days.set(key, bucket)
    }
    return bucket
  }

  const modelBucket = (name) => {
    let bucket = models.get(name)
    if (!bucket) {
      bucket = { model: name, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
      models.set(name, bucket)
    }
    return bucket
  }

  for (const session of sessions) {
    const events = session.events ?? []
    eventCount += events.length
    badLines += session.badLines ?? 0

    const header = events.find((event) => event.type === 'session')
    const sessionId = header?.id ?? session.sessionId ?? 'unknown'
    sessionIds.add(sessionId)

    const createdAt = Number.isFinite(header?.createdAt) ? header.createdAt : events[0]?.time
    const createdDay = Number.isFinite(createdAt) ? dayKey(createdAt) : null
    if (createdDay) dayBucket(createdDay).sessions++

    let currentModel = null
    let sessionHasUsage = false

    for (const event of events) {
      if (event.type === 'request/context') {
        currentModel = event.data?.model ?? currentModel
        continue
      }

      if (event.type === 'request/header') {
        const effort = event.data?.header?.config?.reasoningEffort
        if (effort) bump(efforts, effort)
        continue
      }

      if (event.type === 'tool/call') {
        const name = event.data?.name
        if (name) bump(tools, name)
        continue
      }

      if (event.type === 'step/start') {
        totals.steps++
        if (Number.isFinite(event.time)) dayBucket(dayKey(event.time)).steps++
        continue
      }

      if (event.type === 'turn/start') {
        const turn = event.data?.turn
        if (!Number.isFinite(event.time)) continue
        totals.turns++
        dayBucket(dayKey(event.time)).turns++
        if (turn !== undefined) turnStarts.set(`${sessionId}#${turn}`, event.time)
        continue
      }

      if (event.type === 'turn/end') {
        const turn = event.data?.turn
        const startedAt = turnStarts.get(`${sessionId}#${turn}`)
        if (!Number.isFinite(startedAt) || !Number.isFinite(event.time)) continue
        const ms = event.time - startedAt
        if (!longestTurn || ms > longestTurn.ms) {
          longestTurn = { ms, sessionId, turn, startedAt, endedAt: event.time }
        }
        continue
      }

      if (event.type !== 'assistant/message') continue

      const usage = readUsage(event.data?.usage)
      if (!usage) continue

      sessionHasUsage = true
      usageSessionIds.add(sessionId)
      addUsage(totals, usage)

      const model = event.data?.message?.source?.model ?? currentModel ?? 'unknown'
      const entry = modelBucket(model)
      addUsage(entry, usage)
      entry.calls++

      if (!Number.isFinite(event.time)) continue
      const day = dayBucket(dayKey(event.time))
      addUsage(day, usage)
      day.models[model] = (day.models[model] ?? 0) + usage.total
    }

    if (createdDay && sessionHasUsage) dayBucket(createdDay).usageSessions++
  }

  totals.sessions = sessionIds.size
  totals.usageSessions = usageSessionIds.size

  const dayKeys = [...days.keys()].sort()
  const activeDays = dayKeys.filter((key) => days.get(key).tokens > 0)
  const activeSet = new Set(activeDays)

  let peakDay = null
  for (const key of activeDays) {
    const tokens = days.get(key).tokens
    if (!peakDay || tokens > peakDay.tokens) peakDay = { day: key, tokens }
  }

  // Longest run of consecutive active days.
  let longest = { days: 0, from: null, to: null }
  let runStart = null
  let runLength = 0
  let previous = null
  for (const key of activeDays) {
    const consecutive = previous !== null && Date.parse(`${key}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === DAY_MS
    if (consecutive) {
      runLength++
    } else {
      runStart = key
      runLength = 1
    }
    if (runLength > longest.days) longest = { days: runLength, from: runStart, to: key }
    previous = key
  }

  // Current run: today if active, otherwise still count a run ending yesterday
  // (so the streak does not collapse at midnight before the first message).
  const today = dayKey(now)
  let cursor = activeSet.has(today) ? today : previousDayKey(today)
  const currentTo = activeSet.has(cursor) ? cursor : null
  let currentDays = 0
  let currentFrom = null
  while (activeSet.has(cursor)) {
    currentDays++
    currentFrom = cursor
    cursor = previousDayKey(cursor)
  }

  const requestTotal = [...efforts.values()].reduce((sum, n) => sum + n, 0)
  const toolTotal = [...tools.values()].reduce((sum, n) => sum + n, 0)

  return {
    range: {
      firstDay: activeDays[0] ?? null,
      lastDay: activeDays.at(-1) ?? null,
      activeDays: activeDays.length,
    },
    totals,
    days: Object.fromEntries(dayKeys.map((key) => [key, days.get(key)])),
    models: [...models.values()].sort((a, b) => b.tokens - a.tokens),
    insights: {
      peakDay,
      longestTurn,
      streak: {
        longest,
        current: { days: currentDays, from: currentFrom, to: currentTo },
      },
      reasoning: [...efforts.entries()]
        .map(([effort, requests]) => ({ effort, requests, share: requestTotal ? requests / requestTotal : 0 }))
        .sort((a, b) => b.requests - a.requests),
      tools: [...tools.entries()]
        .map(([name, calls]) => ({ name, calls, share: toolTotal ? calls / toolTotal : 0 }))
        .sort((a, b) => b.calls - a.calls),
    },
    meta: {
      events: eventCount,
      badLines,
      sessions: sessionIds.size,
      usageSessions: usageSessionIds.size,
    },
  }
}
