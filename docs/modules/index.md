# lib/index.js — 宿主插件入口

> 源码：[lib/index.js](../../lib/index.js) · 测试：[test/ping.test.mjs](../../test/ping.test.mjs)

## 一句话职责

插件在 DSH 宿主进程里的入口：声明依赖、注册路由、把清理函数交给框架。当前只有一条探针路由 `/dsh-usage/ping`。

---

## 输入 / 输出

| 导出 | 类型 | 说明 |
|---|---|---|
| `inject` | `['webServer']` | 告诉 Cordis：`webServer` 服务就绪后再调用 `apply` |
| `apply(ctx)` | 函数 | 插件唯一入口；在这里注册所有资源 |
| `createPingHandler()` | `() => (req, res) => void` | 返回路由处理器，便于单独测试 |
| `PING_PATH` | `'/dsh-usage/ping'` | 路由路径，公开契约 |
| `PLUGIN_NAME` | `'dsh-usage'` | 插件标识 |

## 请求流程

```text
curl / 浏览器
   │  GET /dsh-usage/ping
   ▼
ctx.webServer（DSH 的 HTTP 服务）
   │  按 exact 路由匹配
   ▼
createPingHandler() 返回的函数
   │  200 + JSON { ok, name, version, time }
   ▼
响应
```

---

## 关键设计

### 1. 用具名 `apply` + 顶层 `inject`，而不是默认导出一个对象

DSH 官方插件模板（`cordis-plugin-development` 技能）规定的 Host 插件形式是：

```js
export const inject = ['webServer']
export function apply(ctx) { … }
```

写成 `export default { apply }` 也能跑，但和官方文档不一致，排查问题时容易对不上号。

### 2. 为什么注册要包在 `ctx.effect` 里

`webServer.register()` 返回一个卸载函数。`ctx.effect(fn)` 会立即执行 `fn`，并记住返回值作为清理动作。插件停用或热重载时，框架自动调用它。

不包这一层，旧的路由会残留在路由表里；改代码后出现"两个 handler 抢同一个路径"，就是这个原因。

### 3. 为什么版本号从 `package.json` 读

```js
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
```

避免代码里硬编码 `0.0.1`，发布时忘记改。代价是模块加载时多一次文件读取，可以忽略。

---

## 边界与错误

| 情况 | 行为 |
|---|---|
| `webServer` 服务不存在 | `inject` 不满足，`apply` 不会被调用 |
| 同一路径重复注册 | `webServer.register` 抛错（路由冲突是配置错误） |
| 请求未知路径 | 由 DSH 路由表回答 404，与本插件无关 |
| 没有鉴权 | ping 不含任何用户数据，所以暂不拦截；统计路由必须加栅栏（M3） |
| `package.json` 读不到 | 模块加载时抛错，插件激活失败 |

---

## 测试覆盖

`test/ping.test.mjs`（4 个）：声明依赖、注册一条 exact 路由、处理器返回正确 JSON、卸载后路由消失。

测试用一个只实现 `webServer` 和 `effect` 的假 ctx。**如果以后代码偷偷依赖第三个服务，测试会立刻失败**——这是刻意的约束。

---

## 修改须知

- M3 会在同一个 `apply` 里增加 `/dsh-usage/stats.json`。ping 路由保留，用于快速判断"插件是否活着"。
- **不要在模块顶层放可变状态**。热重载会重新执行模块，顶层状态会丢；状态应放在 `apply` 内部，并随 `ctx.effect` 释放。
- 路由路径是公开契约，改了要同步 README 和前端代码。

---

## 术语

- **Cordis**：DSH 使用的插件框架，负责服务注入与生命周期。
- **inject**：声明"我需要哪些服务"，服务就绪后才调用 `apply`。
- **disposer**：注册资源时返回的清理函数，用于撤销注册。
