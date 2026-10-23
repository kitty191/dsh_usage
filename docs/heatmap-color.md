# 热力图颜色规格（已定稿）

> 状态：**已拍板**，作为 M6 的实现契约。
> 数据来源：`lib/stats.mjs` 的 `days[day].tokens`。

## 一句话

颜色代表**当天的 token 用量**，用量越多颜色越深。每天视图用**固定阈值**，不随最近最高值漂移。

---

## 1. 每天视图：5 档 + 空白

| 档位 | 判定 | 含义 |
|---|---|---|
| 0 | `tokens === 0` | 空白格（当天没用） |
| 1 | `0 < tokens < 10,000,000` | 轻度 |
| 2 | `10,000,000 ≤ tokens < 30,000,000` | 中等 |
| 3 | `30,000,000 ≤ tokens < 60,000,000` | 较多 |
| 4 | `60,000,000 ≤ tokens < 120,000,000` | 高 |
| 5 | `tokens ≥ 120,000,000` | 顶格 |

- 阈值是"进入该档的起点"，所以**正好 1000 万**算第 2 档；1000 万以下才是第 1 档。
- 原方案里的 8000 万已**合并**进第 4 档（6000 万 ~ 1.2 亿），保持 5 档易分辨。
- **超过 1.2 亿不再加档**，仍显示第 5 档，悬停显示真实数字。

## 2. 每周视图：阈值 × 7

周总量天然是日总量的 7 倍左右，直接套日用阈值会让所有周都变成最深色。

| 档位 | 判定 |
|---|---|
| 1 | `< 70,000,000` |
| 2 | `70,000,000 ≤ x < 210,000,000` |
| 3 | `210,000,000 ≤ x < 420,000,000` |
| 4 | `420,000,000 ≤ x < 840,000,000` |
| 5 | `≥ 840,000,000` |

图例在每周视图下显示这组周阈值，不显示日阈值。

**呈现方式**：每周视图只画一行，每列一格代表一周；不会把同一周的颜色重复画在 7 个格子里。

## 3. 累计总量视图：相对渐变

累计值随账号使用时长增长，固定阈值没有意义。这一档是**唯一的相对缩放**：

```js
level = Math.min(5, Math.max(1, Math.ceil(5 * cumulative / total)))
```

- `total` 是 **12 个月窗口内的总量**。客户端只有窗口内的 `days`，拿不到账号全周期的前缀，所以累计从窗口起点开始算。
- 比值 20% 以内为第 1 档，100% 为第 5 档。
- 效果：越靠近现在颜色越深，表达"积累过程"。
- 图例在这一档显示"少 → 多"的相对刻度，**不显示具体数字**，避免误解为绝对用量。

---

## 4. 判定函数（M6 实现）

```js
const DAILY = [10_000_000, 30_000_000, 60_000_000, 120_000_000]

export function heatLevel(value, { view = 'daily', total = 0 } = {}) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (view === 'cumulative') {
    if (!Number.isFinite(total) || total <= 0) return 0
    return Math.min(5, Math.max(1, Math.ceil((5 * value) / total)))
  }
  const thresholds = view === 'weekly' ? DAILY.map((n) => n * 7) : DAILY
  let level = 1
  for (const threshold of thresholds) {
    if (value >= threshold) level++
  }
  return level
}
```

阈值只写在**一处**。改阈值等于改变全部颜色，属于视觉破坏性变更。

---

## 5. 颜色定义（最初方案，实现已替换）

全部从 DSH 主题变量派生，不写死颜色。

```css
/* 浅色主题 */
--heat-0: var(--dsw-alias-bg-layer-2);                              /* 空白 */
--heat-1: color-mix(in oklab, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-2));
--heat-2: color-mix(in oklab, var(--dsw-alias-brand-primary) 30%, var(--dsw-alias-bg-layer-2));
--heat-3: color-mix(in oklab, var(--dsw-alias-brand-primary) 50%, var(--dsw-alias-bg-layer-2));
--heat-4: color-mix(in oklab, var(--dsw-alias-brand-primary) 72%, var(--dsw-alias-bg-layer-2));
--heat-5: var(--dsw-alias-brand-primary);
```

```css
/* 深色主题：提高混色比例，避免低档位在深底上看不见 */
--heat-1: color-mix(in oklab, var(--dsw-alias-brand-primary) 20%, var(--dsw-alias-bg-layer-2));
--heat-2: color-mix(in oklab, var(--dsw-alias-brand-primary) 38%, var(--dsw-alias-bg-layer-2));
--heat-3: color-mix(in oklab, var(--dsw-alias-brand-primary) 58%, var(--dsw-alias-bg-layer-2));
--heat-4: color-mix(in oklab, var(--dsw-alias-brand-primary) 78%, var(--dsw-alias-bg-layer-2));
```

> **实现与上面的方案不同**：实测深色主题下 `--dsw-alias-brand-primary` 是很深的藏蓝（`neutral-bluish-1000`），铺在深色面板上几乎看不见，热力图会显示成一片灰。
>
> 现在的实现：颜色用 `--dsw-static-blue-450`（#4d93f8，明暗主题都有定义），并给**两套透明度**——浅色主题需要更实的填充，否则低档位在白底上几乎看不见。

| 档位 | 浅色透明度 | 深色透明度 |
|---|---|---|
| 1 | 0.38 | 0.22 |
| 2 | 0.55 | 0.40 |
| 3 | 0.72 | 0.60 |
| 4 | 0.88 | 0.80 |
| 5 | 1.00 | 1.00 |

- 实现方式：`HEAT_CSS` 里用 `[data-level]` 规则，深色覆盖走 `body[data-ds-dark-theme]`；**不要改回行内透明度**，否则主题切换失效。
- 空白格：`--dsw-alias-bg-layer-2` 打底 + 1px `--dsw-alias-border-l3` 内描边（l3 比 l2 更明显，浅色下才看得见网格）。
- 悬停格：1px `--dsw-alias-border-l3` 外描边。
- 提示框背景在明暗主题下都是深色，所以文字**固定白色**（`#ffffff`）。不要用主题的前景色变量——深色主题下 `label-primary-foreground` 反而是深色。

- 空白格：`--heat-0` 打底 + 1px `--dsw-alias-border-l2` 描边，保证边界可见。
- 悬停格：2px `--dsw-alias-border-l3` 描边，不改变底色。

---

## 6. 图例与交互

**图例（固定在热力图下方）**

```text
少  ▢ ▢ ▢ ▢ ▢  多
```

数字阈值不再显示在界面上——要查具体数字时，悬停格子即可。

**悬停 / 键盘聚焦**

```text
2026-10-18 · 48,073,103 tokens
```

- 每格是 `<div>`，带 `aria-label`；**不设置 Tab 焦点**——371 个格子会成为键盘陷阱。
- 悬停用自定义 tooltip，颜色取自主题变量，不引入第三方库。
- 颜色不是唯一信息渠道：悬停即可读到完整数字。

**网格**

- 列 = 周，行 = 周一…周日（中国习惯，周一起始）。
- 单元格 11px × 11px，间距 3px，圆角 2px。
- 只渲染到"今天"为止；未来日期渲染为不可见格，不响应悬停。
- 月份刻度标在每月第一周所在列的上方。

---

## 7. 边界情况

| 情况 | 行为 |
|---|---|
| 完全没有数据 | 全部空白格，图例照常显示 |
| `total === 0` 且累计视图 | 全部空白，不除零 |
| 正好等于阈值 | 进入更高一档（`>=`） |
| 负数或非数字 | 按 0 处理 |
| 超过 1.2 亿 | 第 5 档，悬停显示真实值 |
| 周视图第一/最后一周不完整 | 按实际天数求和，不按比例外推 |

---

## 8. 验收用的边界测试（M6 已实现）

实现见 `lib/client.js` 的 `heatLevel`；测试见 `test/client.test.mjs`。

```text
9,999,999      → 1
10,000,000     → 2
29,999,999     → 2
30,000,000     → 3
59,999,999     → 3
60,000,000     → 4
119,999,999    → 4
120,000,000    → 5
0 / 负数 / NaN → 0
周视图：69,999,999 → 1；70,000,000 → 2
累计：总量 1000，累计 200 → 1；201 → 2；1000 → 5
```

---

## 9. 变更须知

- 阈值改动会影响全部历史颜色，属于视觉破坏性变更，需要同步改本文档与测试。
- 不要改成"按当前最大值缩放"：那会让同一天的深浅随时间漂移，跨月比较失去意义。
- 累计视图的相对缩放是**唯一例外**，改它之前先确认用户是否真的需要绝对阈值。
