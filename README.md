# DSH Usage

> DeepSeek Harness 设置页里的 Token 用量面板：累计数字、12 个月活动热力图、用量洞察。

数据来自本机会话日志，在本机完成统计，不联网、不上传；面板只展示聚合结果。

## 功能

- **5 张指标卡**：累计 Token、单日峰值、最长单轮、最长连续、当前连续
- **12 个月热力图**：每天 / 每周 / 累计总量三种视图，日/周视图使用固定阈值，累计视图使用相对色阶，悬停显示精确数字
- **明暗主题配色**：浅色主题用量越高蓝色越深，深色主题用量越高蓝色越亮
- **洞察列表**：最常用推理强度、常用模型、会话/轮次/步数、调用最多的工具
- **手动刷新**：绕过宿主 60 秒缓存，失败时保留旧数据

累计数字精确到个位（如 `294,483,483`），不使用"亿/万"缩写。

## 安装

### 通过 DSH 插件管理器（推荐）

左侧边栏 → 插件 → 安装，填入：

```text
github:kitty191/dsh_usage
```

安装并启用组合包后，重启 Harness（`Ctrl/Cmd + Shift + R`）。

### 手动安装

```bash
cd "$DSH_PROFILE_DIR"
pnpm add github:kitty191/dsh_usage
```

然后把 `"dsh-usage"` 追加到同目录 `package.json` 的 `dsh.profile.bundles` 数组，重启 Harness。

> `DSH_PROFILE_DIR` 是当前 profile 的绝对路径。DSH Desktop 通常是
> `~/Library/Application Support/dsh-desktop/harness/profiles/<name>`。

### 本地开发安装

```bash
cd "$DSH_PROFILE_DIR"
pnpm add file:/absolute/path/to/dsh_usage
```

注意：profile 使用 `nodeLinker: hoisted` 时，`file:` 依赖会被复制进 `node_modules`。
改完代码后需要重新 `pnpm add`，或改用 `link:` 依赖做实时迭代。

## 使用

打开 **设置 → Usage**。

- 热力图列 = 周，行 = 周一…周日；悬停格子看日期与完整 token 数。
- 月份标在包含每月 1 日的那一列；开头残缺月份的标签若会重叠，只省略该旧标签，保留后续月份。
- 每天 / 每周 / 累计总量切换聚合方式。
- 底部「刷新」强制重新扫描，通常约 200ms。

## 数据口径（重要）

**这是本地日志口径，不是平台账单口径。**

- 统计来源：`$DSH_HOME/sessions` 下仍然存在的会话日志。
- 不包含：已删除会话、标题生成、联网搜索请求、失败重试、被压缩移除的早期消息。
- 实测差异（2026-10-23）：官方 9/24–10/23 为 `340,998,476`，本地同窗口为 `268,453,338`，差约 21%。当天的差距约 2.6%。
- 结论：累计 Token 用于观察趋势，**不要当作账单数字**。

## 刷新机制

| 层 | 行为 |
|---|---|
| 宿主缓存 | 60 秒。窗口内重复请求直接返回快照 |
| 客户端 | 进入 Usage 时请求一次，不轮询 |
| 手动刷新 | 请求带 `?refresh=1`，跳过缓存 |

## 开发

要求 Node.js 22+，无运行时依赖、无构建步骤。

```bash
node --test          # 46 个测试
node --test --test-name-pattern=heatLevel
```

### 目录

```text
lib/
  index.js     宿主入口：两条只读路由
  scan.mjs     读取会话日志（多帧 zstd）
  stats.mjs    纯函数聚合
  service.mjs  60 秒缓存 + 并发去重
  client.js    浏览器半区（手写 bundle，无 JSX）
docs/
  modules/     每个源文件一份说明
  heatmap-color.md  颜色规格
  ARCHITECTURE.md   架构与数据流
  DEV_NOTES.md      踩坑与经验
test/          46 个测试，5 个测试文件
```

### 修改客户端后的生效方式

客户端 bundle 是纯脚本，不需要构建：

1. 把 `lib/client.js` 复制到 profile 的 `node_modules/dsh-usage/lib/client.js`
2. 刷新窗口（`Cmd/Ctrl + R`）

宿主代码（`lib/index.js` 等）改动需要重启 Harness。

## 文档

- [模块文档索引](docs/modules/README.md)
- [热力图颜色规格](docs/heatmap-color.md)
- [架构与数据流](docs/ARCHITECTURE.md)
- [开发笔记](docs/DEV_NOTES.md)

## 致谢

本项目的部分代码修复、测试与文档由 OpenAI Codex 协助完成。

## License

MIT，见 [LICENSE](LICENSE)。
