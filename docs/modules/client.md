# lib/client.js — 浏览器半区

> 源码：[lib/client.js](../../lib/client.js) · 测试：[test/client.test.mjs](../../test/client.test.mjs)

## 一句话职责

在 DSH 设置页注册一个 **"Usage"** 分区：5 张指标卡、最近 12 个月的 Token 活动热力图（三种视图）、4 行洞察，以及手动刷新。

---

## 加载契约

DSH 的浏览器插件不是普通 ES 模块，而是一段**脚本**：外壳执行它，它只注册一个工厂。

```js
window.__ModuleLoader__.load({
  id: 'dsh-usage',
  factory(require) {
    const React = require('react')
    // …
    return { inject: ['slots'], apply }
  },
})
```

- `id` 与包名一致，便于排查。
- 工厂体内**不做任何副作用**，只定义函数并返回导出。
- `require('react')` 由平台模块表提供，不需要打包 React。

### 为什么手写、不上构建工具

官方包用 tsdown 构建，因为它们的源码是 TypeScript + JSX。我们的界面很小，手写 `React.createElement` 完全够用，代价是：

- 不能写 JSX，元素要用 `h(type, props, ...children)`；
- 没有类型检查。

换来的是**零构建步骤**：改完直接生效，读代码也不需要先"编译"一遍。如果以后界面继续变大，再评估是否引入 esbuild。

---

## 清单声明

`package.json` 需要两处：

```json
"exports": { "./client": "./lib/client.js" },
"dsh": {
  "client": {
    "platform": "web",
    "immediately": true,
    "inject": ["@deepseek-ai/dsh-client-ui-settings"]
  }
}
```

- `platform: "web"`：只在浏览器半区加载。
- `immediately: true`：启动时就物化模块，确保设置页导航里**一开始就有** Usage，而不是等用户点开才注册。
- `inject`：声明依赖的客户端包。这里注入设置页容器，保证 `settings.section` 这个 slot 已经声明。

---

## 分区注册

```js
ctx.effect(() =>
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'usage', order: 50, label: () => 'Usage' },
      UsageSection,
    ),
  ),
)
```

- `slots.inject(name, fn)`：等 slot 可用后再执行注册；`fn` 返回卸载函数。
- `ctx.effect`：把卸载函数交给插件生命周期，停用/HMR 时自动移除分区。
- `id: 'usage'`：同一 slot 内唯一，重复 id 会被 slot core 拒绝。
- `order: 50`：只影响排序，允许重复。

---

## 取数

```js
fetch('/dsh-usage/stats.json')
```

**为什么用相对路径**：桌面端主窗口加载的是 `http://127.0.0.1:<port>/?token=…`（Electron 主进程的 `desktopHarnessUrl` 会给 URL 追加 token），不是 `file://`。因此相对路径会命中同一个服务，并自动带上同源 cookie。

响应处理：

- 先读文本再 `JSON.parse`——鉴权失败时返回的是 HTML 文本，不能让 `res.json()` 抛出一个看不懂的解析错误。
- `!res.ok || body.ok !== true` 一律当失败，显示 `body.error` 或 `HTTP <status>`。

### 手动刷新

底部的「刷新」按钮请求 `?refresh=1`，绕过宿主的 60 秒缓存：

- 刷新期间按钮禁用，文案变成「刷新中…」。
- 成功时用新报告替换当前内容。
- 失败时**保留旧数据**，下方显示「刷新失败：原因」，不会把页面变成错误页。

---

## 三种状态

| 状态 | 界面 |
|---|---|
| loading | `role="status"`："正在统计用量…" |
| ready | 5 张指标卡 + 12 个月热力图 + 洞察列表 + 口径说明 + 刷新按钮 |
| error | `role="alert"`：错误标题＋具体原因，绝不白屏 |

数字格式 `toLocaleString('en-US')`：`250,620,928`。这是产品明确要求——不用"亿/万"，精确到个位。

---

## 指标卡（M5）

| 卡片 | 数据来源 | 副标题 |
|---|---|---|
| 累计 Token | `totals.tokens` | 会话数 |
| 单日峰值 | `insights.peakDay.tokens` | 峰值日期 |
| 最长单轮 | `insights.longestTurn.ms` | "单轮用时" |
| 最长连续 | `insights.streak.longest.days` | 起止日期 |
| 当前连续 | `insights.streak.current.days` | 起止日期 |

**布局**：两行，共用一个圆角容器。第一行三张（累计、峰值、最长单轮），第二行两张（最长连续、当前连续）；每张卡按 6 列网格占 2 格或 3 格，卡片之间用 1px 边线分隔。

> 为什么不用一行 5 张：完整 token 数字太长，5 列会把 `48,073,103` 截成 `48,07...`。两行是数据格式倒逼出来的布局。

**格式化规则**（`formatTokens` / `formatDuration` / `formatDayRange`）：

- Token：完整整数 + 千分位，不缩写、不用"亿/万"。
- 时长：≥1 小时 → `1小时5分`；≥1 分钟 → `23分4秒`（整分省略秒）；否则 `8秒`。
- 日期区间：同一天只显示一个日期，否则 `2026-10-15 → 2026-10-22`。
- 缺数据：Token/时长显示 `—`，天数显示 `0 天`，区间显示 `暂无`。

---

## 洞察列表（M7）

四行，左侧标签、右侧数值：

| 行 | 数据来源 | 示例 |
|---|---|---|
| 最常用推理强度 | `insights.reasoning[0]` | 极高 · 76% |
| 常用模型 | `models[0].model` | deepseek-flash |
| 会话 / 轮次 / 步数 | `totals` | 10 / 235 / 1,102 |
| 调用最多的工具 | `insights.tools[0]` | run_code · 458 次 |

推理强度映射：`max` → 极高，`high` → 高，`medium` → 中，`low` → 低，`minimal` → 极低；未知值原样显示。

---

## 数据口径（重要）

界面底部固定显示一条说明：

> 本地日志口径：不含已删除会话、标题/搜索请求与失败重试，与平台账单可能不同。

- **统计来源**：宿主扫描 `$DSH_HOME/sessions` 下仍然存在的会话日志。
- **官方账单**：平台侧的全部 API 调用，包含已删除会话、标题生成、联网搜索、失败重试等。
- **实测差异（2026-10-23）**：官方 9/24–10/23 为 340,998,476；本地同窗口为 268,453,338，差 21.3%。官方柱状图在 9/24–10/3 有数据，本地为 0——那些日志已经不在磁盘上。
- **结论**：累计 Token 不是账单数字。当天（10/23）两者差距约 2.6%，说明近期数据基本完整，偏差主要来自历史。

---

## 热力图（M6）

- **窗口**：最近 12 个月（53 周），每列一周，周一到周日共 7 格。
- **三种视图**：
  - 每天：每格一天，按日阈值上色。
  - 每周：每列一格，值为该周总和，按周阈值（日阈值 ×7）上色。
  - 累计总量：每格显示窗口内累计值，按窗口总量比例分档——这是唯一的相对刻度。
- **阈值**的权威定义在 [heatmap-color.md](../heatmap-color.md)；代码里只出现在 `DAILY_THRESHOLDS` / `WEEKLY_THRESHOLDS`。
- **悬停**：自定义 tooltip，显示 `2026-10-18 · 48,073,103 tokens`，跟随鼠标且不拦截点击。
- **未来日期**：渲染为不可见格，不响应悬停。
- **图例**：只有 少 / 5 个色块 / 多；不显示数字阈值，避免信息过载（具体数字靠悬停查看）。
- **颜色**：`--dsw-static-blue-450` + 固定透明度 0.22 / 0.40 / 0.60 / 0.80 / 1.00。深色主题的 `brand-primary` 实际是深藏蓝，不能用于填色（详见 [heatmap-color.md](../heatmap-color.md)）。
- **溢出**：热力图包在自己的横向滚动容器里；窄窗口只滚动图表，不会把整页撑宽或裁切卡片。

---

## 主题

所有颜色来自 CSS 变量，不写死：

```css
var(--dsw-alias-label-primary)
var(--dsw-alias-label-secondary)
var(--dsw-alias-label-tertiary)
```

卡片容器使用 `--dsw-alias-bg-layer-1` 打底、`--dsw-alias-border-l2` 描边与分隔线，深色/浅色主题自动切换。

热力图使用 `--dsw-alias-brand-primary` 与 `--dsw-alias-bg-layer-2` 混色，深色主题通过 `body[data-ds-dark-theme]` 提高混色比例。完整色阶见 [heatmap-color.md](../heatmap-color.md)。

---

## 边界与错误

| 情况 | 行为 |
|---|---|
| 接口 500 | 显示 `body.error` |
| 鉴权失败（HTML 响应） | 解析失败 → 显示 `HTTP 401/403` |
| 网络中断 | `fetch` 抛错 → 显示错误文本 |
| `totals.tokens` 缺失 | 显示 `—`，不显示 `NaN` |
| `insights` 整块缺失 | 指标卡照常渲染：峰值/单轮显示 `—`，连续天数显示 `0 天` |
| `longestTurn` 为空 | 显示 `—`，不显示 `NaN分NaN秒` |
| 组件卸载后请求才返回 | `alive` 标志阻止 `setState` |
| 插件停用 | `ctx.effect` 清理分区注册 |

---

## 测试覆盖

`test/client.test.mjs`（16 个）：bundle 注册、导出结构、分区注册与清理、加载态、五卡渲染、两行布局跨度、热力图格子数量与悬停、色阶边界（日/周/累计）、周与累计聚合、洞察列表、刷新绕过缓存、格式化函数边界、缺数据降级、错误态、清单字段。

测试用 `node:vm` 在裸上下文里执行 bundle，用假 React 提供 `useState/useEffect`，所以不需要浏览器。

---

## 修改须知

- **分区 id `usage` 是跨版本契约**：以后改布局不要改 id，否则用户设置导航项会重复或丢失。
- **组件退出时务必取消后续 setState**，否则 HMR 后会警告或闪回旧数据。
- **阈值只写在 `DAILY_THRESHOLDS` / `WEEKLY_THRESHOLDS` 两处**；改阈值等于改变全部历史颜色，必须同步改 [heatmap-color.md](../heatmap-color.md) 与测试。
- 热力图格子使用 `dshUsageHeat-cell` 类名；颜色是行内「蓝色 + 透明度」，不依赖深色主题变量。
- **刷新失败不能清空旧数据**：`refreshError` 单独存，只有初始加载失败才进错误页。
- **真机验证已完成（M4）**：分区出现在设置导航，显示 `250,620,928`，与 `curl /dsh-usage/stats.json` 的返回值一致。
- 客户端改动不需要重启 Harness：把 `lib/client.js` 同步到 profile 的 `node_modules/dsh-usage/lib/client.js`，刷新页面即可加载新 bundle。
