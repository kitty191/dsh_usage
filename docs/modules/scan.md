# lib/scan.mjs — 会话日志读取层

> 源码：[lib/scan.mjs](../../lib/scan.mjs) · 测试：[test/scan.test.mjs](../../test/scan.test.mjs)

## 一句话职责

把磁盘上的 DSH 会话日志读成**事件对象数组**。只负责读，不负责算。

---

## 数据从哪来

```text
<root>/<项目路径编码>/session-<uuid>/session.v4.jsonl.zstd
```

- `root` 默认是 `$DSH_HOME/sessions`；没有 `DSH_HOME` 时退回 `~/.dsh/sessions`。
- 同一个会话目录里可能有 `v3`、`v4` 多个版本，**只读版本号最大的那个**，否则同一段对话会被统计两遍。
- `session.lock` 之类的文件会被忽略。

---

## 输入 / 输出

| 函数 | 输入 | 输出 | 用途 |
|---|---|---|---|
| `defaultSessionRoots(env, home)` | 环境变量、用户目录 | `string[]` | 决定扫哪些目录 |
| `listSessionLogs(roots)` | 目录列表 | `{ sessionId, path, version }[]` | 找文件、按会话去重 |
| `decodeFrames(buffer)` | 压缩数据 | `Buffer` | 多帧解压 |
| `parseJsonl(text)` | 文本 | `{ events, badLines }` | 一行一个 JSON |
| `readSessionLog(path)` | 单个文件路径 | `{ path, sessionId, version, events, badLines }` | 读一个会话 |
| `scanSessions({ roots })` | 目录列表 | `{ sessions, errors }` | 读全部，单文件失败不影响整体 |

`sessions` 的元素就是 `readSessionLog` 的返回值；`errors` 元素为 `{ path, message }`。

---

## 关键设计

### 1. 为什么自己切帧，而不是直接解压

Node 的 `zlib.zstdDecompressSync` **只解第一帧就停**。实测同一个日志：

```text
文件大小            3,352,014 字节
zstdDecompressSync       229 字节   ← 只解了第一段
zstd -dc          11,308,725 字节   ← 完整内容
```

DSH 每写一次就追加一个独立压缩帧，所以必须按 zstd 帧格式**自己找边界**，再逐帧解压。`frameEnd()` 只读长度信息、不解内容，因此很快。

### 2. 为什么坏行只计数、不抛错

会话可能正被写入，文件尾部是半行。抛错会导致整个会话读取失败，代价远大于跳过一行。所以 `parseJsonl` 返回 `badLines`，把问题交给上层展示。

### 3. 为什么坏文件不拖垮全局

一个文件损坏不应该让整页数据消失。`scanSessions` 用 try/catch 把失败文件收进 `errors`，其余会话照常返回。

---

## 图解：一个日志文件长什么样

```text
┌─────────┬─────────┬─────────┬─────────┐
│ 帧 1    │ 帧 2    │ 帧 3    │  …      │  ← 顺序拼接，各自独立压缩
└─────────┴─────────┴─────────┴─────────┘

每一帧内部：
magic(4) | frame_header(1) | [window] [dict] [content_size]
         | block_header(3) + block_data  … 重复到"最后一块"标志
         | [checksum(4)]
```

帧内文本是 JSONL：一行一个事件，例如 `{"type":"turn/start","time":…,"data":{…}}`。

---

## 边界与错误

| 情况 | 行为 |
|---|---|
| 目录不存在 | 跳过，不报错（首次安装时很正常） |
| 空文件 | 返回空事件数组 |
| 非 zstd 数据 | 抛错，由 `scanSessions` 收进 `errors` |
| 帧被截断 | 抛错并指出字节位置 |
| RLE 块 | 按格式规范只前进 1 字节（块头记录的是解压后大小） |
| skippable 帧 | 跳过，不计入事件 |
| 非 UTF-8 字节 | 按 UTF-8 解码，坏字节变成替换字符，行解析失败则计入 `badLines` |
| 同一会话多版本 | 只取版本号最大的 |
| 两个数据目录都有会话 | 按 `session-<uuid>` 目录名去重，保留版本更高的 |

---

## 测试覆盖

`test/scan.test.mjs`（8 个）：多帧解压、空 buffer、坏行计数、版本去重、端到端读取、坏文件隔离、目录解析规则、真实日志冒烟（没有数据时自动跳过）。

---

## 修改须知

- **下游是 `lib/stats.mjs`**：改返回结构会直接影响聚合层，必须同步改测试。
- **目录布局是观察值，不是契约**：DSH 升级可能改路径或文件名；改之前先跑真实数据测试。
- **跨目录去重策略仍是临时的**：当前按 session 目录名去重。如果同一次对话在两个数据目录里 id 不同，会重复计数——要用真实数据先验证再改。
- **性能**：目前 10 个会话约 150ms。会话数量上千后需要缓存或增量读取（M3 起做缓存）。

---

## 术语

- **帧（frame）**：zstd 的一次独立压缩单元。一个文件可以由多帧拼成。
- **JSONL**：一行一个 JSON 对象的文本格式。
- **skippable 帧**：zstd 规范允许的"占位帧"，内容应被忽略。
