// dsh-usage — browser half.
// 设计说明：docs/modules/client.md
//
// Loaded by DSH as a plain browser bundle: the shell executes this file, which
// only registers a factory. The module body (and therefore any side effect)
// runs when the module system first materializes it.
//
// Kept build-free on purpose: the bundle contract is small enough to write by
// hand, and a hand-written file is easier to read than a compiled one. The
// trade-off is no JSX — React elements are built with React.createElement.
window.__ModuleLoader__.load({
  id: 'dsh-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const STATS_URL = '/dsh-usage/stats.json'
    const DAY_MS = 86400000
    const BEIJING_OFFSET_MS = 8 * 3600000

    // Fixed thresholds, in tokens. Daily and weekly are absolute; cumulative is
    // the only relative scale (see docs/heatmap-color.md).
    const DAILY_THRESHOLDS = [10000000, 30000000, 60000000, 120000000]
    const WEEKLY_THRESHOLDS = [70000000, 210000000, 420000000, 840000000]
    // Brand primary turns into a very dark navy in the dark theme, which is
    // invisible on a dark panel. A static blue plus opacity reads correctly in
    // both themes and keeps the five steps distinct.
    const LEVEL_OPACITY = [0, 0.22, 0.4, 0.6, 0.8, 1]
    const VIEWS = [
      { id: 'daily', label: '每天' },
      { id: 'weekly', label: '每周' },
      { id: 'cumulative', label: '累计总量' },
    ]

    const HEAT_CSS = [
      '.dshUsageHeat-cell{width:10px;height:10px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}',
      '.dshUsageHeat-cell:hover{outline:1px solid var(--dsw-alias-border-l3);outline-offset:1px}',
    ].join('')

    const styles = {
      section: {
        display: 'grid',
        gap: '18px',
        padding: '4px 0',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary)',
      },
      heading: {
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
      },
      cards: {
        display: 'grid',
        // Two rows: three cards, then two wider ones. Exact token counts are
        // long, so a five-column single row truncates them.
        gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
        columnGap: 0,
        rowGap: '14px',
        padding: '16px 4px',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      card: {
        minWidth: 0,
        padding: '0 14px',
      },
      divider: {
        borderLeft: '1px solid var(--dsw-alias-border-l2)',
      },
      label: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      },
      value: {
        marginTop: '6px',
        fontSize: '22px',
        lineHeight: 1.25,
        fontWeight: 600,
        letterSpacing: '-0.4px',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      sub: {
        marginTop: '4px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      activity: {
        display: 'grid',
        gap: '10px',
        minWidth: 0,
      },
      heatWrap: {
        maxWidth: '100%',
        minWidth: 0,
        overflowX: 'auto',
        paddingBottom: '2px',
      },
      activityHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      },
      tabs: {
        display: 'flex',
        gap: '2px',
        padding: '2px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      tab: {
        fontSize: '11px',
        lineHeight: '18px',
        padding: '1px 8px',
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
      },
      tabActive: {
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
      },
      months: {
        display: 'flex',
        gap: '2px',
        marginBottom: '5px',
      },
      monthSlot: {
        width: '10px',
        flex: '0 0 10px',
        position: 'relative',
        height: '13px',
      },
      monthText: {
        position: 'absolute',
        left: 0,
        top: 0,
        fontSize: '10px',
        lineHeight: '13px',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
        whiteSpace: 'nowrap',
      },
      grid: {
        display: 'flex',
        gap: '2px',
      },
      column: {
        display: 'grid',
        gridTemplateRows: 'repeat(7, 10px)',
        gap: '2px',
      },
      columnWeekly: {
        display: 'grid',
        gridTemplateRows: '10px',
        gap: '2px',
      },
      hiddenCell: {
        visibility: 'hidden',
      },
      legend: {
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        flexWrap: 'wrap',
        fontSize: '10px',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      },
      note: {
        marginTop: '-6px',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      },
      footerRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      },
      rows: {
        display: 'grid',
        borderTop: '1px solid var(--dsw-alias-border-l2)',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '10px 2px',
        borderBottom: '1px solid var(--dsw-alias-border-l2)',
      },
      rowLabel: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      rowValue: {
        fontSize: '13px',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--dsw-alias-label-primary)',
        whiteSpace: 'nowrap',
      },
      refreshButton: {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        lineHeight: '18px',
        padding: '1px 8px',
        borderRadius: '6px',
        cursor: 'pointer',
      },
      refreshError: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-primary)',
      },
      error: {
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
      },
      tooltip: {
        position: 'fixed',
        transform: 'translate(-50%, -100%)',
        marginTop: '-8px',
        padding: '4px 8px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-tooltip-bg)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        fontSize: '11px',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 9999,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
      },
    }

    /** Fetch the report; throws a readable message on any failure. */
    async function loadStats(force) {
      const requestUrl = force ? STATS_URL + '?refresh=1' : STATS_URL
      const response = await fetch(requestUrl, { headers: { accept: 'application/json' } })
      const text = await response.text()
      let body = null
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || 'HTTP ' + response.status)
      }
      return body
    }

    function formatTokens(value) {
      return Number.isFinite(value) ? value.toLocaleString('en-US') : '—'
    }

    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '—'
      const total = Math.round(ms / 1000)
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours > 0) return minutes > 0 ? hours + '小时' + minutes + '分' : hours + '小时'
      if (minutes > 0) return seconds > 0 ? minutes + '分' + seconds + '秒' : minutes + '分'
      return seconds + '秒'
    }

    function formatDayRange(part) {
      if (!part || !part.from || !part.to) return '暂无'
      return part.from === part.to ? part.from : part.from + ' → ' + part.to
    }

    const EFFORT_LABELS = { max: '极高', high: '高', medium: '中', low: '低', minimal: '极低' }

    function effortLabel(effort) {
      return EFFORT_LABELS[effort] || effort || '—'
    }

    function formatTime(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    /** Beijing day key for an instant (the report uses the same boundary). */
    function beijingKey(ms) {
      return new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
    }

    function keyToUtc(key) {
      return Date.parse(key + 'T00:00:00Z')
    }

    function utcToKey(ms) {
      return new Date(ms).toISOString().slice(0, 10)
    }

    /**
     * Map a value to one of five levels (0 = empty).
     * Daily/weekly use fixed thresholds; cumulative is relative to the window.
     */
    function heatLevel(value, options) {
      const view = (options && options.view) || 'daily'
      const total = (options && options.total) || 0
      if (!Number.isFinite(value) || value <= 0) return 0
      if (view === 'cumulative') {
        if (!Number.isFinite(total) || total <= 0) return 0
        return Math.min(5, Math.max(1, Math.ceil((5 * value) / total)))
      }
      const thresholds = view === 'weekly' ? WEEKLY_THRESHOLDS : DAILY_THRESHOLDS
      let level = 1
      for (const threshold of thresholds) {
        if (value >= threshold) level++
      }
      return level
    }

    /**
     * Build the 53-week grid ending today.
     * Columns are weeks (Monday first); a cell is one day for daily/cumulative,
     * or one whole week for the weekly view.
     */
    function buildHeatmap(report, view, todayKey) {
      const today = todayKey || beijingKey(Date.now())
      const end = keyToUtc(today)
      const start = end - 364 * DAY_MS
      const startWeekday = new Date(start).getUTCDay()
      const gridStart = start - ((startWeekday + 6) % 7) * DAY_MS
      const totalDays = Math.floor((end - gridStart) / DAY_MS) + 1
      const days = (report && report.days) || {}

      const daily = []
      let cumulative = 0
      for (let index = 0; index < totalDays; index++) {
        const ms = gridStart + index * DAY_MS
        const key = utcToKey(ms)
        const bucket = days[key]
        const value = bucket && Number.isFinite(bucket.tokens) ? bucket.tokens : 0
        cumulative += value
        daily.push({ key, value, cumulative, future: ms > end })
      }
      const grandTotal = cumulative

      const columns = []
      const labelByColumn = {}
      let previousMonth = null
      const columnCount = Math.ceil(totalDays / 7)

      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const cells = []
        let weekValue = 0
        for (let row = 0; row < 7; row++) {
          const item = daily[columnIndex * 7 + row]
          if (!item) {
            cells.push(null)
            continue
          }
          weekValue += item.value
          cells.push(item)
        }
        const monday = cells.find(Boolean)
        const month = monday ? monday.key.slice(0, 7) : null
        if (month && month !== previousMonth) {
          labelByColumn[columnIndex] = Number(month.slice(5)) + '月'
          previousMonth = month
        }
        columns.push({ key: monday ? monday.key : 'w' + columnIndex, cells, weekValue })
      }

      for (const column of columns) {
        if (view === 'weekly') {
          column.cell = {
            key: column.key,
            value: column.weekValue,
            level: heatLevel(column.weekValue, { view: 'weekly' }),
            future: false,
          }
          continue
        }
        for (const cell of column.cells) {
          if (!cell) continue
          const display = view === 'cumulative' ? cell.cumulative : cell.value
          cell.display = display
          cell.level = heatLevel(display, { view, total: grandTotal })
        }
      }

      return { view, columns, labelByColumn, total: grandTotal }
    }

    function cellText(view, key, value) {
      const head = view === 'weekly' ? key + ' 那一周' : key
      return head + ' · ' + formatTokens(value) + ' tokens'
    }

    function UsageSection() {
      const [state, setState] = React.useState({ status: 'loading' })
      const [view, setView] = React.useState('daily')
      const [hover, setHover] = React.useState(null)
      const [refreshing, setRefreshing] = React.useState(false)
      const [refreshError, setRefreshError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        loadStats().then(
          (body) => {
            if (alive) setState({ status: 'ready', body })
          },
          (error) => {
            if (alive) setState({ status: 'error', message: String(error && error.message ? error.message : error) })
          },
        )
        return () => {
          alive = false
        }
      }, [])

      async function refresh() {
        if (refreshing) return
        setRefreshing(true)
        setRefreshError('')
        try {
          const body = await loadStats(true)
          setState({ status: 'ready', body })
        } catch (error) {
          setRefreshError(String(error && error.message ? error.message : error))
        } finally {
          setRefreshing(false)
        }
      }

      if (state.status === 'loading') {
        return h('div', { style: styles.section, role: 'status' }, h('div', { style: styles.label }, '正在统计用量…'))
      }

      if (state.status === 'error') {
        return h(
          'div',
          { style: styles.section, role: 'alert' },
          h('div', { style: styles.label }, '读取用量失败'),
          h('div', { style: styles.error }, state.message),
        )
      }

      const { totals = {}, insights = {}, updatedAt } = state.body
      const peak = insights.peakDay
      const longestTurn = insights.longestTurn
      const streak = insights.streak || {}
      const longestStreak = streak.longest || { days: 0 }
      const currentStreak = streak.current || { days: 0 }

      const cards = [
        { label: '累计 Token', value: formatTokens(totals.tokens), sub: (totals.sessions || 0) + ' 个会话' },
        { label: '单日峰值', value: formatTokens(peak && peak.tokens), sub: (peak && peak.day) || '暂无数据' },
        { label: '最长单轮', value: formatDuration(longestTurn && longestTurn.ms), sub: '单轮用时' },
        { label: '最长连续', value: (longestStreak.days || 0) + ' 天', sub: formatDayRange(longestStreak) },
        { label: '当前连续', value: (currentStreak.days || 0) + ' 天', sub: formatDayRange(currentStreak) },
      ]

      const reasoning = insights.reasoning || []
      const topEffort = reasoning[0]
      const models = state.body.models || []
      const topModel = models[0]
      const tools = insights.tools || []
      const topTool = tools[0]

      const insightRows = [
        {
          label: '最常用推理强度',
          value: topEffort ? effortLabel(topEffort.effort) + ' · ' + Math.round((topEffort.share || 0) * 100) + '%' : '—',
        },
        { label: '常用模型', value: topModel ? topModel.model : '—' },
        {
          label: '会话 / 轮次 / 步数',
          value: [totals.sessions || 0, totals.turns || 0, totals.steps || 0].map(formatTokens).join(' / '),
        },
        {
          label: '调用最多的工具',
          value: topTool ? topTool.name + ' · ' + formatTokens(topTool.calls || 0) + ' 次' : '—',
        },
      ]

      const heat = buildHeatmap(state.body, view, beijingKey(Date.now()))
      const tooltip = hover ? h('div', { style: Object.assign({}, styles.tooltip, { left: hover.x, top: hover.y }) }, hover.text) : null

      function cellElement(cell) {
        if (!cell) return h('div', { key: 'empty' })
        const value = view === 'cumulative' ? cell.display : cell.value
        const text = cellText(view, cell.key, value)
        const level = cell.future ? 0 : cell.level
        const painted = level > 0
        return h('div', {
          key: cell.key,
          className: 'dshUsageHeat-cell',
          'data-level': level,
          'aria-label': cell.future ? 'future' : text,
          style: cell.future
            ? styles.hiddenCell
            : painted
              ? {
                  backgroundColor: 'var(--dsw-static-blue-450, #4d93f8)',
                  opacity: LEVEL_OPACITY[level],
                  boxShadow: 'none',
                }
              : undefined,
          onMouseEnter: cell.future ? undefined : (event) => setHover({ x: event.clientX, y: event.clientY, text }),
          onMouseMove: cell.future ? undefined : (event) => setHover({ x: event.clientX, y: event.clientY, text }),
          onMouseLeave: cell.future ? undefined : () => setHover(null),
        })
      }

      return h(
        'div',
        { style: styles.section, 'data-usage-section': 'summary' },
        h('style', { key: 'heat-css' }, HEAT_CSS),
        h('div', { style: styles.heading }, 'Token 总览'),
        h(
          'div',
          { style: styles.cards },
          cards.map((card, index) => {
            const firstInRow = index === 0 || index === 3
            return h(
              'div',
              {
                key: card.label,
                style: Object.assign({}, styles.card, firstInRow ? {} : styles.divider, {
                  gridColumn: 'span ' + (index < 3 ? 2 : 3),
                }),
              },
              h('div', { style: styles.label }, card.label),
              h('div', { style: styles.value, title: card.value }, card.value),
              h('div', { style: styles.sub, title: card.sub }, card.sub),
            )
          }),
        ),
        h(
          'div',
          { style: styles.activity },
          h(
            'div',
            { style: styles.activityHeader },
            h('div', { style: styles.heading }, 'Token 活动'),
            h(
              'div',
              { style: styles.tabs },
              VIEWS.map((option) =>
                h(
                  'button',
                  {
                    key: option.id,
                    type: 'button',
                    onClick: () => {
                      setView(option.id)
                      setHover(null)
                    },
                    style: Object.assign({}, styles.tab, option.id === view ? styles.tabActive : {}),
                  },
                  option.label,
                ),
              ),
            ),
          ),
          h(
            'div',
            { style: styles.heatWrap },
            h(
              'div',
              { style: styles.months },
              heat.columns.map((column, index) =>
                h(
                  'div',
                  { key: 'm' + index, style: styles.monthSlot },
                  heat.labelByColumn[index]
                    ? h('span', { style: styles.monthText }, heat.labelByColumn[index])
                    : null,
                ),
              ),
            ),
            h(
              'div',
              { style: styles.grid },
              heat.columns.map((column, index) =>
                h(
                  'div',
                  {
                    key: 'c' + index,
                    style: view === 'weekly' ? styles.columnWeekly : styles.column,
                  },
                  (view === 'weekly' ? [column.cell] : column.cells).map(cellElement),
                ),
              ),
            ),
          ),
          h(
            'div',
            { style: styles.legend },
            h('span', null, '少'),
            [1, 2, 3, 4, 5].map((level) =>
              h('span', {
                key: 'l' + level,
                className: 'dshUsageHeat-cell',
                'data-level': level,
                style: {
                  backgroundColor: 'var(--dsw-static-blue-450, #4d93f8)',
                  opacity: LEVEL_OPACITY[level],
                  boxShadow: 'none',
                },
              }),
            ),
            h('span', null, '多'),
          ),
        ),
        h(
          'div',
          { style: styles.activity },
          h('div', { style: styles.heading }, '洞察'),
          h(
            'div',
            { style: styles.rows },
            insightRows.map((row, index) =>
              h(
                'div',
                {
                  key: row.label,
                  style:
                    index === insightRows.length - 1
                      ? Object.assign({}, styles.row, { borderBottom: 'none' })
                      : styles.row,
                },
                h('span', { style: styles.rowLabel }, row.label),
                h('span', { style: styles.rowValue }, row.value),
              ),
            ),
          ),
        ),
        h(
          'div',
          { style: styles.note },
          '本地日志口径：不含已删除会话、标题/搜索请求与失败重试，与平台账单可能不同。',
        ),
        h(
          'div',
          { style: styles.footerRow },
          h('span', null, (totals.sessions || 0) + ' 个会话 · ' + formatTime(updatedAt) + ' 更新'),
          h(
            'button',
            { type: 'button', onClick: refresh, disabled: refreshing, style: styles.refreshButton },
            refreshing ? '刷新中…' : '刷新',
          ),
        ),
        refreshError ? h('div', { style: styles.refreshError }, '刷新失败：' + refreshError) : null,
        tooltip,
      )
    }

    function apply(ctx) {
      ctx.effect(() =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'usage',
              order: 50,
              label: () => 'Usage',
            },
            UsageSection,
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply,
      UsageSection,
      STATS_URL,
      loadStats,
      formatTokens,
      formatDuration,
      formatDayRange,
      heatLevel,
      buildHeatmap,
      beijingKey,
    }
  },
})
