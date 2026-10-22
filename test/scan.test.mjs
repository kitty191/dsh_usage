// M1 tests: the reading layer, with no DSH and no real session data needed.
// Fixtures are real zstd frames built in the test, so the multi-frame path is
// exercised exactly the way DSH writes it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import {
  decodeFrames,
  defaultSessionRoots,
  listSessionLogs,
  parseJsonl,
  readSessionLog,
  scanSessions,
} from '../lib/scan.mjs'

function compress(text) {
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'))
}

function makeTempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-usage-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeSession(dir, project, sessionId, fileName, frames) {
  const target = path.join(dir, project, sessionId)
  mkdirSync(target, { recursive: true })
  const file = path.join(target, fileName)
  writeFileSync(file, Buffer.concat(frames))
  return file
}

test('decodeFrames decodes concatenated frames', () => {
  const joined = Buffer.concat([compress('{"a":1}\n'), compress('{"b":2}\n')])
  assert.equal(decodeFrames(joined).toString('utf8'), '{"a":1}\n{"b":2}\n')
})

test('decodeFrames handles an empty buffer', () => {
  assert.equal(decodeFrames(Buffer.alloc(0)).length, 0)
})

test('parseJsonl keeps valid lines and counts broken ones', () => {
  const { events, badLines } = parseJsonl('{"x":1}\nnot json\n\n{"y":2}\n')
  assert.equal(events.length, 2)
  assert.deepEqual(events[1], { y: 2 })
  assert.equal(badLines, 1)
})

test('listSessionLogs keeps only the newest version per session', (t) => {
  const dir = makeTempDir(t)
  writeSession(dir, '--project--', 'session-a', 'session.v3.jsonl.zstd', [compress('{"v":3}\n')])
  writeSession(dir, '--project--', 'session-a', 'session.v4.jsonl.zstd', [compress('{"v":4}\n')])
  writeSession(dir, '--project--', 'session-b', 'session.jsonl.zstd', [compress('{"v":0}\n')])
  writeFileSync(path.join(dir, '--project--', 'session-a', 'session.lock'), '')

  const logs = listSessionLogs([dir])
  assert.equal(logs.length, 2)
  assert.equal(logs.find((l) => l.sessionId === 'session-a').version, 4)
  assert.equal(logs.find((l) => l.sessionId === 'session-b').version, 0)
})

test('readSessionLog reads a multi-frame log end to end', (t) => {
  const dir = makeTempDir(t)
  const file = writeSession(dir, '--project--', 'session-a', 'session.v4.jsonl.zstd', [
    compress('{"type":"turn/start","turn":1}\n'),
    compress('{"type":"turn/end","turn":1}\n'),
  ])

  const log = readSessionLog(file)
  assert.equal(log.sessionId, 'session-a')
  assert.equal(log.version, 4)
  assert.equal(log.events.length, 2)
  assert.equal(log.events[1].type, 'turn/end')
  assert.equal(log.badLines, 0)
})

test('scanSessions keeps good sessions when one file is corrupt', (t) => {
  const dir = makeTempDir(t)
  writeSession(dir, '--project--', 'session-good', 'session.v1.jsonl.zstd', [
    compress('{"type":"session"}\n'),
  ])
  const broken = writeSession(dir, '--project--', 'session-bad', 'session.v1.jsonl.zstd', [])
  writeFileSync(broken, Buffer.from('this is not zstd'))

  const { sessions, errors } = scanSessions({ roots: [dir] })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].sessionId, 'session-good')
  assert.equal(errors.length, 1)
  assert.match(errors[0].path, /session-bad/)
})

test('defaultSessionRoots prefers DSH_HOME and falls back to ~/.dsh', () => {
  const withHome = defaultSessionRoots({ DSH_HOME: '/tmp/harness' }, '/Users/example')
  assert.equal(withHome[0], path.join('/tmp/harness', 'sessions'))
  assert.equal(withHome[1], path.join('/Users/example', '.dsh', 'sessions'))

  const withoutHome = defaultSessionRoots({}, '/Users/example')
  assert.equal(withoutHome.length, 1)
})

// Optional integration check: runs only where real session logs exist.
const realRoots = defaultSessionRoots()
const hasRealData = listSessionLogs(realRoots).length > 0

test('scans real session logs when present', { skip: !hasRealData && 'no session logs on this machine' }, () => {
  const { sessions, errors } = scanSessions({ roots: realRoots })
  assert.ok(sessions.length > 0)
  assert.ok(sessions.some((s) => s.events.length > 0))
  assert.equal(errors.length, 0)
})
