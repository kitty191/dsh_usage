# lib/stats.mjs — 用量聚合层

> 源码：[lib/stats.mjs](../../lib/stats.mjs) · 测试：[test/stats.test.mjs](../../test/stats.test.mjs)

## 一句话职责

把事件数组算成页面要显示的数字。**纯函数**：不读文件、不联网、不看系统时钟。

---

## 输入 / 输出

| 导出 | 输入 | 输出 |
|---|---|---|
| `dayKey(ms)` | 时间戳 | `'YYYY-MM-DD'`（北京时间） |
| `readUsage(usage)` | 一条 usage 记录 | `{ total, input, output, cacheRead, cacheWrite, reasoning }` |
| `aggregateSessions(sessions, { now })` | `scanSessions().sessions` | 完整报告对象 |

报告结构：

```text
{
  range:   { firstDay, lastDay, activeDays },
  totals:  { tokens, input, output, cacheRead, cacheWrite, reasoning,
             steps, turns, sessions, usageSessions },
  days:    { 'YYYY-MM-DD': { 同上字段, models: { 模型: token } } },
  models:  [ { model, tokens, input, output, cacheRead, cacheWrite, reasoning, calls } ],
  insights: {
    peakDay:     { day, tokens } | null,
    longestTurn: { ms, sessionId, turn, startedAt, endedAt } | null,
    streak:      { longest: {days,from,to}, current: {days,from,to} },
    reasoning:   [ { effort, requests, share } ],
    tools:       [ { name, calls, share } ]
  },
  meta:    { events, badLines, sessions, usageSessions }
}
```

---

## 关键设计

### 1. 纯函数 + 注入时钟

`aggregateSessions(sessions, { now })` 把"现在几点"作为参数传进来。

好处：测试连续天数时不需要等到凌晨，传一个假时间就能验证所有边界。副作用为零，同样的输入永远得到同样的输出。

### 2. Token 公式是验证过的，不是猜的

```text
totalTokens === inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
真实数据吻合：792 / 792 条
```

所以优先使用 `totalTokens`；缺失才用四项相加兜底。

**`reasoningTokens` 已经包含在 output 里**，只展示、不重复相加。早期版本的实现如果把它加上去，总量会虚高。

### 3. 日期边界是北京时间

```js
new Date(ms + 8 * 3600_000).toISOString().slice(0, 10)
```

时间戳是绝对时间，加 8 小时再取日期，就得到北京时间的"今天"。这与 DSH 自身的日界线一致。

### 4. 连续天数的"安静午夜"规则

今天有记录 → 从今天往前数；今天还没说话 → 从昨天往前数。

否则每天零点一到，连续天数立刻归零，用户会以为数据出错。

### 5. 最长单轮靠编号配对

`turn/start` 与 `turn/end` 是独立事件，用 `sessionId + turn` 配对。没有结束事件的（正在进行中）跳过，不能算成 0。

---

## 数据流

```text
scanSessions()                         aggregateSessions()
┌──────────────────┐                  ┌──────────────────────┐
│ session A events │──┐               │ 逐事件分类累计        │
│ session B events │──┼──────────────►│  → totals / days     │
│ session C events │──┘               │  → models / insights │
└──────────────────┘                  └──────────────────────┘
                                                 │
                                                 ▼
                                        一份 JSON 报告
```

单次遍历完成所有累计，时间复杂度 O(事件数)。

---

## 边界与错误

| 情况 | 行为 |
|---|---|
| 空历史 | 返回全 0 报告，`peakDay`/`longestTurn` 为 `null`，不出现 `NaN` |
| 事件缺 `time` | 不参与按天统计，但仍计入总量 |
| usage 缺 `totalTokens` | 用四项之和兜底 |
| `turn/start` 没有 `turn/end` | 忽略，不产生时长 |
| 请求数为 0 | `share` 为 0，不会除零 |
| 某天只有事件没有 token | 仍会出现在 `days` 里，但不算活跃日 |
| 同一会话多版本 | 由 `scan.mjs` 去重，本层不处理 |

---

## 测试覆盖

`test/stats.test.mjs`（6 个）：日界线、token 公式、按天与模型归属、工具/推理强度/最长单轮、连续天数（含安静午夜与断签）、空历史。

---

## 口径限制

`totals` 只汇总**日志里仍然存在的 usage**。以下调用在平台侧可能计费，但不会出现在这里：

- 已删除会话的日志
- 标题生成（`session/title-llm-request`）
- 联网搜索（`web/deepseek-search-llm-request`）
- 失败重试（`llm/retry`，没有 usage 回执）
- 被压缩移除的早期消息

实测差异见 [client.md](client.md#数据口径重要)：2026-10-23 那天，官方 9/24–10/23 为 340,998,476，本地同窗口为 268,453,338。

**不要把这里的 `totals.tokens` 当作账单数字。**

---

## 修改须知

- **这是前端的数据契约**。M5–M7 的卡片、热力图、洞察全部读这个结构；改字段名等于破坏契约，必须同步改前端和测试。
- `days` 里可能包含零 token 的日期（只创建了会话），热力图渲染时要自行处理。
- 双数据目录的去重发生在 `scan.mjs`，这里假设输入已经去重。
- 新增统计项时，优先加在 `insights` 下，避免动 `totals` 的既有字段。

---

## 术语

- **纯函数**：同样输入永远同样输出、没有副作用的函数。
- **usage**：`assistant/message` 事件里的 token 用量记录。
- **活跃日**：当天 token 总量大于 0。
