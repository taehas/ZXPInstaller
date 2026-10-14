import { scanExtensions, detectApps, analyze, summarize, debugModeState, HOST_NAMES, MAX_CEP_RUNTIME } from './scanner.js'
import { disableExtension, enableExtension, removeExtension } from './actions.js'
const { dialog, shell } = require('@electron/remote')

const fmtSize = b => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export class Manager {
  constructor () {
    this.extensions = []
    this.apps = []
    this.filter = 'all'
    this.query = ''
    this.loaded = false
    this.root = document.querySelector('#manage-view')
    this.list = this.root.querySelector('.ext-list')
    this.insights = this.root.querySelector('.insights')

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => this.showTab(t.dataset.tab)))
    this.root.querySelectorAll('.chip[data-filter]').forEach(c => c.addEventListener('click', () => {
      this.filter = c.dataset.filter
      this.root.querySelectorAll('.chip[data-filter]').forEach(x => x.classList.toggle('is-active', x === c))
      this.render()
    }))
    this.root.querySelector('.search').addEventListener('input', e => {
      this.query = e.target.value.toLowerCase(); this.render()
    })
    this.root.querySelector('.rescan').addEventListener('click', () => this.refresh())
    this.list.addEventListener('click', e => this.onListClick(e))
    this.insights.addEventListener('click', e => this.onInsightClick(e))
  }

  showTab (name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name))
    document.querySelector('#install-view').hidden = name !== 'install'
    this.root.hidden = name !== 'manage'
    document.body.classList.toggle('manage', name === 'manage')
    if (name === 'manage' && !this.loaded) this.refresh()
  }

  refresh () {
    this.list.innerHTML = '<div class="empty">Scanning…</div>'
    // Let the "Scanning…" paint before the synchronous scan.
    setTimeout(() => {
      this.apps = detectApps()
      this.extensions = analyze(scanExtensions(), this.apps)
      this.debug = debugModeState()
      this.loaded = true
      this.render()
    }, 30)
  }

  visible () {
    return this.extensions
      .filter(e => {
        if (this.filter === 'disabled') return !e.enabled
        if (this.filter === 'issues') return e.issues.some(i => i.level !== 'info')
        return true
      })
      .filter(e => !this.query || `${e.name} ${e.folder} ${e.bundleId}`.toLowerCase().includes(this.query))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.version > b.version ? -1 : 1))
  }

  render () {
    const s = summarize(this.extensions)
    const cards = []
    cards.push(`<div class="insight"><div class="grow"><strong>${s.total}</strong> extensions (${fmtSize(s.totalBytes)}) across <strong>${this.apps.length}</strong> detected Adobe apps · <strong>${s.withIssues}</strong> need attention · <strong>${s.disabled}</strong> disabled</div></div>`)
    if (s.cleanup.length) {
      cards.push(`<div class="insight warn"><div class="grow"><strong>${s.cleanup.length}</strong> safe cleanup suggestion${s.cleanup.length > 1 ? 's' : ''} (${fmtSize(s.cleanupBytes)}): outdated versions or extensions that target no installed app. Removed items go to the Trash.</div><button class="act" data-do="review">Review &amp; clean up</button></div>`)
    }
    const dbg = (this.debug || []).filter(d => d.on).map(d => d.version)
    if (dbg.length) {
      cards.push(`<div class="insight"><div class="grow">CEP debug mode is on for CSXS ${dbg.join(', ')}. Unsigned extensions will load; turn it off if you don't need that.</div></div>`)
    } else if (this.extensions.some(e => !e.signed && !e.adobeManaged && !e.error)) {
      cards.push(`<div class="insight"><div class="grow">Some extensions are unsigned and need CEP debug mode (CSXS 9–${MAX_CEP_RUNTIME}) to load, which is currently off.</div></div>`)
    }
    this.insights.innerHTML = cards.join('')

    const rows = this.visible()
    if (!rows.length) {
      this.list.innerHTML = '<div class="empty">No extensions match.</div>'
      return
    }
    this.list.innerHTML = rows.map(e => this.row(e)).join('')
  }

  row (e) {
    const hosts = [...new Set(e.hosts.map(h => HOST_NAMES[h.name] || h.name))]
    const idx = this.extensions.indexOf(e)
    const protectedExt = e.adobeManaged
    return `<div class="ext ${e.enabled ? '' : 'is-disabled'}" data-i="${idx}">
      <div class="ext-main">
        <div class="ext-name">${esc(e.name)}</div>
        <div class="ext-meta">
          <span>v${esc(e.version || '?')}</span>
          <span class="badge scope">${e.scope}</span>
          ${protectedExt ? '<span class="badge managed">managed by Creative Cloud</span>' : ''}
          ${e.enabled ? '' : '<span class="badge">disabled</span>'}
          <span>${esc(hosts.join(', ') || 'no host info')}</span>
          <span>${fmtSize(e.size)}</span>
        </div>
        ${e.issues.map(i => `<div class="issue ${i.level}">${esc(i.message)}</div>`).join('')}
      </div>
      <div class="ext-actions">
        <button class="act" data-do="reveal">Reveal</button>
        ${protectedExt ? '' : `<button class="act" data-do="${e.enabled ? 'disable' : 'enable'}">${e.enabled ? 'Disable' : 'Enable'}</button><button class="act danger" data-do="remove">Remove</button>`}
      </div>
    </div>`
  }

  async onListClick (ev) {
    const btn = ev.target.closest('[data-do]')
    if (!btn) return
    const ext = this.extensions[parseInt(btn.closest('.ext').dataset.i, 10)]
    const act = btn.dataset.do
    try {
      if (act === 'reveal') return shell.showItemInFolder(ext.dir)
      if (act === 'remove' && !(await this.confirm(`Move “${ext.name}” ${ext.version || ''} to the Trash?`, ext.dir))) return
      if (act === 'disable') await disableExtension(ext)
      if (act === 'enable') await enableExtension(ext)
      if (act === 'remove') await removeExtension(ext, shell)
      this.refresh()
    } catch (err) {
      dialog.showErrorBox('Action failed', err.message)
    }
  }

  async onInsightClick (ev) {
    if (!ev.target.closest('[data-do="review"]')) return
    const { cleanup } = summarize(this.extensions)
    const detail = cleanup.map(e => `• ${e.name} ${e.version || ''} (${e.scope}) – ${e.suggestRemove}`).join('\n')
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Move to Trash', 'Disable instead', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
      message: `Clean up ${cleanup.length} extension${cleanup.length > 1 ? 's' : ''}?`,
      detail,
    })
    if (response === 2) return
    const failures = []
    for (const e of cleanup) {
      try {
        response === 0 ? await removeExtension(e, shell) : await disableExtension(e)
      } catch (err) {
        failures.push(`${e.name}: ${err.message}`)
      }
    }
    if (failures.length) dialog.showErrorBox('Some items failed', failures.join('\n'))
    this.refresh()
  }

  async confirm (message, detail) {
    const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['Move to Trash', 'Cancel'], defaultId: 1, cancelId: 1, message, detail })
    return response === 0
  }
}
