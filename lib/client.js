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

    const styles = {
      section: {
        display: 'grid',
        gap: '14px',
        padding: '4px 0',
        maxWidth: '860px',
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
      footer: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      },
      error: {
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
      },
    }

    /** Fetch the report; throws a readable message on any failure. */
    async function loadStats() {
      const response = await fetch(STATS_URL, { headers: { accept: 'application/json' } })
      const text = await response.text()
      let body = null
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || `HTTP ${response.status}`)
      }
      return body
    }

    /** Full integer with thousand separators — the product asks for exact values. */
    function formatTokens(value) {
      return Number.isFinite(value) ? value.toLocaleString('en-US') : '—'
    }

    /** 1384000 → "23分4秒"; hours drop the seconds, minutes drop a zero tail. */
    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '—'
      const total = Math.round(ms / 1000)
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`
      if (minutes > 0) return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`
      return `${seconds}秒`
    }

    function formatDayRange(part) {
      if (!part || !part.from || !part.to) return '暂无'
      return part.from === part.to ? part.from : `${part.from} → ${part.to}`
    }

    function formatTime(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    /** The settings section: a five-card overview of the whole history. */
    function UsageSection() {
      const [state, setState] = React.useState({ status: 'loading' })

      React.useEffect(() => {
        let alive = true
        loadStats().then(
          (body) => {
            if (alive) setState({ status: 'ready', body })
          },
          (error) => {
            if (alive) setState({ status: 'error', message: String(error?.message ?? error) })
          },
        )
        return () => {
          alive = false
        }
      }, [])

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
      const streak = insights.streak ?? {}
      const longestStreak = streak.longest ?? { days: 0 }
      const currentStreak = streak.current ?? { days: 0 }

      const cards = [
        {
          label: '累计 Token',
          value: formatTokens(totals.tokens),
          sub: `${totals.sessions ?? 0} 个会话`,
        },
        {
          label: '单日峰值',
          value: formatTokens(peak?.tokens),
          sub: peak?.day ?? '暂无数据',
        },
        {
          label: '最长单轮',
          value: formatDuration(longestTurn?.ms),
          sub: '单轮用时',
        },
        {
          label: '最长连续',
          value: `${longestStreak.days ?? 0} 天`,
          sub: formatDayRange(longestStreak),
        },
        {
          label: '当前连续',
          value: `${currentStreak.days ?? 0} 天`,
          sub: formatDayRange(currentStreak),
        },
      ]

      return h(
        'div',
        { style: styles.section, 'data-usage-section': 'summary' },
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
                style: {
                  ...styles.card,
                  ...(firstInRow ? {} : styles.divider),
                  gridColumn: `span ${index < 3 ? 2 : 3}`,
                },
              },
              h('div', { style: styles.label }, card.label),
              h('div', { style: styles.value, title: card.value }, card.value),
              h('div', { style: styles.sub, title: card.sub }, card.sub),
            )
          }),
        ),
        h(
          'div',
          { style: styles.footer },
          `本地会话日志 · ${totals.sessions ?? 0} 个会话 · ${formatTime(updatedAt)} 更新`,
        ),
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
    }
  },
})
