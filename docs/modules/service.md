# lib/service.mjs — 缓存与数据服务

> 源码：[lib/service.mjs](../../lib/service.mjs) · 测试：[test/service.test.mjs](../../test/service.test.mjs)

## 一句话职责

把"扫描 + 聚合"包成一个**带缓存的异步服务**。HTTP 层只负责转发，不关心数据怎么来。

---

## 输入 / 输出

```js
createStatsService({
  roots,      // 扫哪些目录，默认 defaultSessionRoots()
  scan,       // 默认 scanSessions，测试时可替换
  aggregate,  // 默认 aggregateSessions
  ttlMs,      // 缓存有效期，默认 60_000
  now,        // 时钟，测试时注入
}) → { getStats, invalidate }
```

`getStats({ force })` 返回：

```json
{
  "ok": true,
  "updatedAt": "2026-10-22T13:46:45.656Z",
  "cached": false,
  "durationMs": 214,
  "range": { "firstDay": "2026-09-21", "lastDay": "2026-10-22", "activeDays": 12 },
  "totals": { "tokens": 230906504, "...": "..." },
  "days": { "2026-10-18": { "tokens": 48073103, "models": {} } },
  "models": [ { "model": "deepseek-flash", "tokens": 230906504 } ],
  "insights": { "peakDay": {}, "longestTurn": {}, "streak": {}, "reasoning": [], "tools": [] },
  "meta": { "events": 7400, "badLines": 0, "sessions": 10, "usageSessions": 4, "errors": [] }
}
```

失败时**抛异常**，由 HTTP 层转成 `500 { ok:false, error }`。

---

## 关键设计

### 1. 为什么必须有缓存

实测一次全量扫描 + 聚合约 **214ms**（10 个会话）。页面每次刷新都重扫既慢又浪费，所以默认缓存 60 秒。命中缓存后响应只要 **1ms**。

`?refresh=1` 可以强制重新扫描（用户手动点"刷新"时用）。

### 2. 并发请求只扫一次

页面首屏可能同时发多个请求。如果每个都去扫描，CPU 会被打满，而且结果还可能不一致。

实现方式是一个 `inflight` 承诺：第一个请求负责扫描，其余请求 `await` 同一个承诺。扫描结束后清空，下一次再触发。

### 3. 失败不能毁掉已有缓存

扫描失败时直接抛错，**不修改缓存**。上一个成功的快照仍然有效，下一次请求可以重新尝试，不需要等缓存过期。

部分文件损坏不属于"失败"：`scanSessions` 会把它们收集起来，最终出现在 `meta.errors` 里，页面可以提示"有 2 个文件读取失败"但仍然展示数据。

### 4. 为什么错误用 500 而不是 200

有些 API 习惯"永远返回 200，用 ok 字段区分"。这里选 500，理由是：

- 监控和日志能直接按状态码筛出失败；
- 前端 `fetch` 的 `res.ok` 就能判断，不需要先解析 JSON；
- 语义正确：这不是"成功的空数据"，是"这次没算出来"。

正文仍然是 JSON，前端照样能拿到 `error` 文本。

### 5. 依赖注入：为了能测

`scan`、`aggregate`、`now` 都可以替换，所以 7 个测试全部在内存里跑，不碰真实文件、不等待真实时间。

---

## 数据流

```text
HTTP 请求
   │
   ▼
createStatsHandler()
   │  service.getStats({ force })
   ▼
┌─────────────── service ───────────────┐
│  缓存新鲜？ ── 是 ──► 返回快照          │
│      │否                              │
│      ▼                                │
│  有正在进行的扫描？ ── 是 ──► 等它      │
│      │否                              │
│      ▼                                │
│  scan() → aggregate() → 存入缓存        │
└───────────────────────────────────────┘
   │
   ▼
200 JSON（或失败时 500）
```

---

## 边界与错误

| 情况 | 行为 |
|---|---|
| 第一次请求 | 全量扫描，约 200ms，`cached: false` |
| 60 秒内再次请求 | 直接返回快照，约 1ms，`cached: true` |
| `?refresh=1` | 忽略缓存重新扫描 |
| 多个请求同时到达 | 共享同一次扫描 |
| 部分文件损坏 | 正常返回，问题在 `meta.errors` |
| `scan` 整体抛错 | 请求得到 500，旧缓存保留 |
| 完全没有历史 | 返回 `ok:true` 加全 0 报告 |
| 进程重启 | 缓存清空，第一次请求重新扫描 |

---

## 测试覆盖

`test/service.test.mjs`（7 个）：缓存命中、强制刷新、TTL 过期、并发共享、错误透传、失败后恢复、手动失效。

`test/ping.test.mjs` 里另有 2 个针对 HTTP 适配层的测试：refresh 参数透传、失败转 500。

---

## 修改须知

- **`payload` 是前端契约**（M5–M7 都依赖它）。加字段可以，改名字不行。
- **缓存是进程内内存**，不落盘；重启即失效。这是有意的简化。
- **TTL 是常量**，如果以后做增量扫描，把它换成"数据变化才失效"。
- **鉴权应加在 HTTP 层**（`createStatsHandler`），不要塞进 service，否则测试会变复杂。
- **双数据目录去重**发生在 `scan.mjs`，这里假设输入已去重。

---

## 术语

- **TTL（Time To Live）**：缓存的有效期。
- **in-flight**：已经开始、尚未完成的请求；这里用来去重。
- **force**：跳过缓存强制重新计算。
