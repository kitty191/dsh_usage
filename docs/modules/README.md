# 模块文档索引

每个源文件对应一份说明，文件名保持一致（`lib/scan.mjs` → `modules/scan.md`）。

## 阅读顺序

建议按数据流动的方向读：

```text
index.js  →  scan.mjs  →  stats.mjs  →  service.mjs  →  client.js
入口         读文件        算数字         缓存与接口       界面
```

## 文档列表

| 源码 | 文档 | 状态 |
|---|---|---|
| [lib/index.js](../../lib/index.js) | [index.md](index.md) | ✅ 已完成 |
| [lib/scan.mjs](../../lib/scan.mjs) | [scan.md](scan.md) | ✅ 已完成 |
| [lib/stats.mjs](../../lib/stats.mjs) | [stats.md](stats.md) | ✅ 已完成 |
| [lib/service.mjs](../../lib/service.mjs) | [service.md](service.md) | ✅ 已完成 |
| lib/client.js | client.md | ⬜ M4 |

## 设计文档

| 文档 | 内容 |
|---|---|
| [heatmap-color.md](../heatmap-color.md) | 热力图颜色规格：阈值、色阶、图例、边界 |

## 写作规则

1. **只写"为什么"，不翻译代码**。逐行解释等于维护第二份代码。
2. **写实测数字**（例如"只解出 229 字节"），它们比形容词更可靠，也方便发现行为变化。
3. **必须有"边界与错误"和"修改须知"**：一份文档的价值，一半在于告诉后来人"改这里会牵动谁"。
4. **改代码的那次提交，必须同时改对应文档**。过期的文档比没有文档更危险。
