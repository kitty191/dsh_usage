# 架构与数据流

## 一句话

宿主半区读本地会话日志，聚合成一份 JSON；浏览器半区在设置页渲染。两侧通过一条只读 HTTP 路由通信。

## 数据流

```text
$DSH_HOME/sessions/**/session.v*.jsonl.zstd
        │
        ▼
lib/scan.mjs        多帧 zstd → JSONL → 事件数组
        │
        ▼
lib/stats.mjs       纯函数聚合：天 / 模型 / 洞察
        │
        ▼
lib/service.mjs     60 秒缓存 + 并发去重 + 错误契约
        │
        ▼
lib/index.js        GET /dsh-usage/stats.json
        │
        ▼
lib/client.js       fetch → 设置页「Usage」分区
```

另有 `GET /dsh-usage/ping`：只回答插件是否加载，用于区分"插件没起来"和"统计链路坏了"。

## 模块

| 文件 | 职责 | 文档 |
|---|---|---|
| `lib/index.js` | 注册路由、绑定生命周期 | [modules/index.md](modules/index.md) |
| `lib/scan.mjs` | 找日志、解多帧 zstd、解析 JSONL | [modules/scan.md](modules/scan.md) |
| `lib/stats.mjs` | 纯函数聚合，零 I/O | [modules/stats.md](modules/stats.md) |
| `lib/service.mjs` | 缓存、并发、错误传播 | [modules/service.md](modules/service.md) |
| `lib/client.js` | 手写浏览器 bundle：卡片、热力图、洞察 | [modules/client.md](modules/client.md) |

## 关键决策

### 1. 宿主与浏览器分成两个半区

宿主负责"数据"，浏览器负责"展示"。好处：接口可以单独用 `curl` 验证；界面改坏不会影响数据层；两侧可以独立测试。

代价是跨半区通信需要一条 HTTP 契约，字段改名要两边同步。

### 2. 直接扫文件，而不是依赖官方查询服务

v1 选择扫描 `$DSH_HOME/sessions` 下的日志：实现简单、现场可验证。风险是目录布局属于观察值，DSH 升级可能改。

缓解：读取逻辑集中在 `lib/scan.mjs`，将来换成 `ctx.sessionQuery` 只需替换这一层。

### 3. 服务端缓存 60 秒 + 手动强制刷新

全量扫描约 200ms，页面每次进入都扫既慢又浪费。缓存命中约 1ms；`?refresh=1` 供用户主动更新。

失败时**不覆盖旧缓存**：上一个成功快照仍然有效。

### 4. 数据口径是"本地日志"，不是账单

日志里只有仍然存在的会话。已删除会话、标题生成、联网搜索、失败重试不会出现。界面底部固定展示这条说明。

实测差异见 [client.md](modules/client.md) 的「数据口径」一节。这是产品边界，不是 bug。

### 5. 热力图用固定阈值，颜色用静态蓝 + 透明度

颜色不能随"最近最大值"漂移，否则同一天的深浅会随时间变化。所以用固定阈值（1000 万 / 3000 万 / 6000 万 / 1.2 亿）。

深色主题下 `--dsw-alias-brand-primary` 是深藏蓝，铺在深色面板上不可见；因此改用 `--dsw-static-blue-450` 加透明度分档。见 [heatmap-color.md](heatmap-color.md)。

### 6. 无鉴权的边界

两条路由都只读，统计接口只返回聚合数字（不含会话标题或正文），服务默认只监听回环地址，也不返回 CORS 头。

威胁模型有限：能访问本机的进程本来就能直接读日志文件。

## 失败与边界

| 层 | 失败行为 |
|---|---|
| 单个日志损坏 | 记入 `meta.errors`，其余会话照常返回 |
| 扫描整体失败 | 请求得到 500 + `{ ok:false, error }`，旧缓存保留 |
| 客户端请求失败 | 显示错误原因，不白屏 |
| 刷新失败 | 保留旧数据，只显示一行「刷新失败」 |
| 没有历史数据 | 全 0 报告，无 `NaN` |

## 扩展点

- **换数据源**：只改 `lib/scan.mjs` 的 `scanSessions`。
- **加视图**：`buildHeatmap` + `heatLevel` 是纯函数，可直接加测试。
- **加洞察**：`lib/stats.mjs` 的 `insights` 是开放式字段，客户端按需读取。
- **发布**：npm 上 `dsh-usage` 已被占用，当前通过 GitHub 安装；若要发布，改名或使用 scope。
