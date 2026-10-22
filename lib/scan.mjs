// dsh-usage — reading layer.
// 设计说明：docs/modules/scan.md
//
// One job: turn session files on disk into an array of event objects.
// No aggregation, no HTTP, no caching — those belong to later modules.
//
// The awkward part is the file format: DSH appends one zstd frame per flush,
// so a session log is a *concatenation* of frames. Node's zstdDecompressSync
// stops after the first frame (verified: 229 bytes out of an 11 MB log), so we
// walk the zstd frame structure ourselves and decompress frame by frame.
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528

/** session-<uuid>/session.v4.jsonl.zstd */
const SESSION_FILE_PATTERN = /^session(?:\.v(\d+))?\.jsonl\.zstd$/

/**
 * Find the end of the zstd frame that starts at `start`.
 *
 * Layout (RFC 8878):
 *   magic(4) | frame_header_descriptor(1) | [window_descriptor]
 *   [dictionary_id] [frame_content_size]
 *   block_header(3) + block_data ... (until the "last block" bit)
 *   [content_checksum(4)]
 *
 * We only need lengths, never the decoded content, so this is a walk, not a
 * decoder. Returning the exact boundary is what makes multi-frame logs work.
 */
function frameEnd(buffer, start) {
  let pos = start + 4
  const descriptor = buffer[pos++]
  const fcsFlag = descriptor >> 6
  const singleSegment = (descriptor >> 5) & 1
  const hasChecksum = (descriptor >> 2) & 1
  const dictIdFlag = descriptor & 0x03

  if (!singleSegment) pos += 1 // window descriptor
  pos += [0, 1, 2, 4][dictIdFlag]
  pos += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag]

  for (; ;) {
    if (pos + 3 > buffer.length) throw new Error(`truncated block header at byte ${pos}`)
    const header = buffer[pos] | (buffer[pos + 1] << 8) | (buffer[pos + 2] << 16)
    pos += 3
    const lastBlock = header & 1
    const blockType = (header >> 1) & 0x03
    const blockSize = header >>> 3
    // RLE blocks store one byte and describe their regenerated size.
    pos += blockType === 1 ? 1 : blockSize
    if (lastBlock) break
  }

  if (hasChecksum) pos += 4
  if (pos > buffer.length) throw new Error(`frame overruns buffer at byte ${start}`)
  return pos
}

/**
 * Decode a buffer holding one or more zstd frames (plus optional skippable
 * frames) into a single Buffer.
 */
export function decodeFrames(buffer) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('this Node.js build has no zstd support (need Node >= 22.15)')
  }
  if (buffer.length === 0) return Buffer.alloc(0)

  const chunks = []
  let pos = 0
  while (pos < buffer.length) {
    // Skippable frame: 0x184D2A50..0x5F, followed by a 4-byte payload length.
    const skippable =
      (buffer[pos] & 0xf0) === 0x50 &&
      buffer[pos + 1] === 0x2a &&
      buffer[pos + 2] === 0x4d &&
      buffer[pos + 3] === 0x18
    if (skippable) {
      pos += 8 + buffer.readUInt32LE(pos + 4)
      continue
    }
    if (buffer.readUInt32LE(pos) !== ZSTD_MAGIC) {
      throw new Error(`not a zstd frame at byte ${pos}`)
    }
    const end = frameEnd(buffer, pos)
    chunks.push(zlib.zstdDecompressSync(buffer.subarray(pos, end)))
    pos = end
  }
  return Buffer.concat(chunks)
}

/**
 * Parse JSONL into events. A damaged tail (a session that was being written
 * while we read it) must not lose the valid lines before it, so bad lines are
 * counted instead of thrown.
 */
export function parseJsonl(text) {
  const events = []
  let badLines = 0
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      badLines++
    }
  }
  return { events, badLines }
}

/** Session roots to scan: the running DSH's own home first, then ~/.dsh. */
export function defaultSessionRoots(env = process.env, home = homedir()) {
  const roots = []
  if (env.DSH_HOME) roots.push(path.join(env.DSH_HOME, 'sessions'))
  roots.push(path.join(home, '.dsh', 'sessions'))
  return [...new Set(roots)]
}

/**
 * List session log files, keeping only the newest `session.v<N>` per session.
 * A session directory can hold several versions; reading all of them would
 * count the same turns twice.
 */
export function listSessionLogs(roots) {
  const best = new Map()

  for (const root of roots) {
    let projectDirs
    try {
      projectDirs = readdirSync(root, { withFileTypes: true })
    } catch {
      continue // a missing root is normal, not an error
    }
    for (const project of projectDirs) {
      if (!project.isDirectory()) continue
      const projectPath = path.join(root, project.name)
      let sessionDirs
      try {
        sessionDirs = readdirSync(projectPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const session of sessionDirs) {
        if (!session.isDirectory() || !session.name.startsWith('session-')) continue
        const sessionPath = path.join(projectPath, session.name)
        let files
        try {
          files = readdirSync(sessionPath, { withFileTypes: true })
        } catch {
          continue
        }
        for (const file of files) {
          if (!file.isFile()) continue
          const match = SESSION_FILE_PATTERN.exec(file.name)
          if (!match) continue
          const version = match[1] ? Number(match[1]) : 0
          const filePath = path.join(sessionPath, file.name)
          const existing = best.get(session.name)
          if (!existing || version > existing.version) {
            best.set(session.name, { sessionId: session.name, path: filePath, version })
          }
        }
      }
    }
  }

  return [...best.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** Read and decode one session log file. */
export function readSessionLog(filePath) {
  const buffer = readFileSync(filePath)
  const { events, badLines } = parseJsonl(decodeFrames(buffer).toString('utf8'))
  const version = Number(SESSION_FILE_PATTERN.exec(path.basename(filePath))?.[1] ?? 0)
  return { path: filePath, sessionId: path.basename(path.dirname(filePath)), version, events, badLines }
}

/**
 * Read every session in the given roots.
 *
 * A corrupt file must not take the whole scan down: it becomes an entry in
 * `errors` while the remaining sessions are still returned.
 */
export function scanSessions({ roots = defaultSessionRoots() } = {}) {
  const sessions = []
  const errors = []
  for (const file of listSessionLogs(roots)) {
    try {
      sessions.push(readSessionLog(file.path))
    } catch (error) {
      errors.push({ path: file.path, message: String(error?.message ?? error) })
    }
  }
  return { sessions, errors }
}
