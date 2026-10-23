# lib/client.js — 浏览器半区

> 源码：[lib/client.js](../../lib/client.js) · 测试：[test/client.test.mjs](../../test/client.test.mjs)

## 一句话职责

在 DSH 设置页注册一个 **"Usage"** 分区，读取宿主接口并显示累计 Token。M4 阶段只显示一个数字，用来证明客户端链路是通的。

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

换来的是**零构建步骤**：改完直接生效，读代码也不需要先"编译"一遍。界面变大（M6 热力图）时可以重新评估是否引入 esbuild。

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

---

## 三种状态

| 状态 | 界面 |
|---|---|
| loading | `role="status"`："正在统计用量…" |
| ready | 累计 Token 完整数字（千分位）＋ 会话数 ＋ 更新时间 |
| error | `role="alert"`：错误标题＋具体原因，绝不白屏 |

数字格式 `toLocaleString('en-US')`：`230,906,504`。这是产品明确要求——不用"亿/万"，精确到个位。

---

## 主题

所有颜色来自 CSS 变量，不写死：

```css
var(--dsw-alias-label-primary)
var(--dsw-alias-label-secondary)
var(--dsw-alias-label-tertiary)
```

M6 的热力图会再引入 `--dsw-alias-brand-primary` 与 `bg-layer-2`，见 [heatmap-color.md](../heatmap-color.md)。

---

## 边界与错误

| 情况 | 行为 |
|---|---|
| 接口 500 | 显示 `body.error` |
| 鉴权失败（HTML 响应） | 解析失败 → 显示 `HTTP 401/403` |
| 网络中断 | `fetch` 抛错 → 显示错误文本 |
| `totals.tokens` 缺失 | 显示 0，不显示 `NaN` |
| 组件卸载后请求才返回 | `alive` 标志阻止 `setState` |
| 插件停用 | `ctx.effect` 清理分区注册 |

---

## 测试覆盖

`test/client.test.mjs`（8 个）：bundle 注册、导出结构、分区注册与清理、加载态、成功态（断言 `1,234,567` 与"3 个会话"）、错误态、清单字段。

测试用 `node:vm` 在裸上下文里执行 bundle，用假 React 提供 `useState/useEffect`，所以不需要浏览器。

---

## 修改须知

- **分区 id `usage` 是跨版本契约**：以后改布局不要改 id，否则用户设置导航项会重复或丢失。
- **组件退出时务必取消后续 setState**，否则 HMR 后会警告或闪回旧数据。
- M5/M6 会把这里的内容扩展成指标卡与热力图，但**取数方式与错误契约保持不动**。
- 真机验证仍未完成：客户端能否被 DSH 加载、分区能否出现在导航里，需要在安装后确认。
