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
        gap: '6px',
        padding: '8px 0 4px',
        maxWidth: '720px',
        color: 'var(--dsw-alias-label-primary)',
      },
      label: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      value: {
        fontSize: '32px',
        fontWeight: 600,
        letterSpacing: '-0.5px',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.2,
      },
      meta: {
        fontSize: '12px',
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

    function formatTime(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    /** The one thing M4 proves: this section exists and can read real numbers. */
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

      const { totals, updatedAt } = state.body
      const tokens = Number.isFinite(totals?.tokens) ? totals.tokens : 0

      return h(
        'div',
        { style: styles.section, 'data-usage-section': 'summary' },
        h('div', { style: styles.label }, '累计 Token'),
        h('div', { style: styles.value }, tokens.toLocaleString('en-US')),
        h(
          'div',
          { style: styles.meta },
          `本地会话日志 · ${totals?.sessions ?? 0} 个会话 · ${formatTime(updatedAt)} 更新`,
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

    return { inject: ['slots'], apply, UsageSection, STATS_URL, loadStats }
  },
})
