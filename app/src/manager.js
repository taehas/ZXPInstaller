import { scanExtensions, detectApps, analyze, summarize, debugModeState, setDebugMode, normalizeName, HOST_NAMES, MAX_CEP_RUNTIME } from './scanner.js'
import { listUpia, removeUpia } from './upia.js'
import { disableExtension, enableExtension, trashPath } from './actions.js'
import { findLeftovers } from './leftovers.js'
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
    setTimeout(async () => {
      this.apps = detectApps()
      this.extensions = analyze(scanExtensions(), this.apps)
      this.debug = debugModeState()
      this.upiaEntries = await listUpia()
      this.others = this.unmatched(this.upiaEntries)
      this.loaded = true
      this.render()
    }, 30)
  }

  // Plugins Adobe's installer reports that aren't CEP folders we scanned (mostly UXP),
  // merged across the apps they're installed in.
  unmatched (entries) {
    const known = new Set(this.extensions.flatMap(e => [e.name, e.folder, e.bundleId].filter(Boolean).map(normalizeName)))
    const merged = new Map()
    for (const e of entries) {
      if (known.has(normalizeName(e.name))) continue
      const key = `${e.name}\0${e.version}`
      if (!merged.has(key)) merged.set(key, { name: e.name, version: e.version, products: [], status: e.status })
      merged.get(key).products.push(e.product)
    }
    return [...merged.values()]
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
    const unsigned = this.extensions.filter(e => !e.signed && !e.adobeManaged && !e.error).length
    if (dbg.length) {
      cards.push(`<div class="insight"><div class="grow">CEP debug mode is on for CSXS ${dbg.join(', ')}. Unsigned extensions load, and so could anything else dropped into the extensions folder. Turn it off if you don't need it${unsigned ? ` (${unsigned} installed extension${unsigned > 1 ? 's are' : ' is'} unsigned and would stop loading)` : ''}.</div><button class="act" data-do="debug-off">Turn off</button></div>`)
    } else if (unsigned) {
      cards.push(`<div class="insight"><div class="grow">${unsigned} installed extension${unsigned > 1 ? 's are' : ' is'} unsigned and need CEP debug mode (CSXS 9–${MAX_CEP_RUNTIME}) to load. It is currently off.</div><button class="act" data-do="debug-on">Turn on</button></div>`)
    }
    this.insights.innerHTML = cards.join('')

    const rows = this.visible()
    if (!rows.length) {
      this.list.innerHTML = '<div class="empty">No extensions match.</div>'
      return
    }
    this.list.innerHTML = rows.map(e => this.row(e)).join('') + this.othersHtml()
  }

  othersHtml () {
    const others = this.filter === 'all' ? (this.others || []).filter(o => !this.query || o.name.toLowerCase().includes(this.query)) : []
    if (!others.length) return ''
    return '<div class="section-title">Other plugins seen by Adobe\'s installer (UXP and others)</div>' + others.map((o, i) => `<div class="ext" data-o="${i}">
      <div class="ext-main">
        <div class="ext-name">${esc(o.name)}</div>
        <div class="ext-meta"><span>v${esc(o.version)}</span><span class="badge">${esc(o.status.toLowerCase())}</span><span>${esc([...new Set(o.products)].join(', '))}</span></div>
      </div>
      <div class="ext-actions"><button class="act danger" data-do="remove-other">Remove</button></div>
    </div>`).join('')
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
        ${protectedExt ? '' : `<button class="act" data-do="${e.enabled ? 'disable' : 'enable'}">${e.enabled ? 'Disable' : 'Enable'}</button><button class="act danger" data-do="uninstall">Uninstall…</button>`}
      </div>
    </div>`
  }

  async onListClick (ev) {
    const btn = ev.target.closest('[data-do]')
    if (!btn) return
    const act = btn.dataset.do
    if (act === 'remove-other') return this.removeOther(this.others[parseInt(btn.closest('.ext').dataset.o, 10)])
    const ext = this.extensions[parseInt(btn.closest('.ext').dataset.i, 10)]
    try {
      if (act === 'reveal') return shell.showItemInFolder(ext.dir)
      if (act === 'uninstall') return this.deepUninstall(ext)
      if (act === 'disable') await disableExtension(ext)
      if (act === 'enable') await enableExtension(ext)
      this.refresh()
    } catch (err) {
      dialog.showErrorBox('Action failed', err.message)
    }
  }

  async removeOther (o) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Remove “${o.name}”?`,
      detail: `Clears it from Adobe's installer registry and uninstalls it from ${[...new Set(o.products)].join(', ')}. This cannot be undone from here.`,
    })
    if (response !== 0) return
    try {
      await removeUpia(o.name)
      this.refresh()
    } catch (err) {
      dialog.showErrorBox('Removal failed', err.message)
    }
  }

  async onInsightClick (ev) {
    const dbgBtn = ev.target.closest('[data-do^="debug-"]')
    if (dbgBtn) {
      const on = dbgBtn.dataset.do === 'debug-on'
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: [on ? 'Turn on' : 'Turn off', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Turn CEP debug mode ${on ? 'on' : 'off'}?`,
        detail: `Changes the PlayerDebugMode setting for CSXS 9–${MAX_CEP_RUNTIME}. Restart your Adobe apps afterwards.`,
      })
      if (response !== 0) return
      try {
        setDebugMode(on)
        this.refresh()
      } catch (err) {
        dialog.showErrorBox('Could not change setting', err.message)
      }
      return
    }
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
        response === 0 ? await trashPath(e, shell) : await disableExtension(e)
      } catch (err) {
        failures.push(`${e.name}: ${err.message}`)
      }
    }
    if (response === 0) await this.deregister(cleanup, failures)
    if (failures.length) dialog.showErrorBox('Some items failed', failures.join('\n'))
    this.refresh()
  }

  // Adobe's installer keeps its own registry. Without clearing it, reinstalling an older or
  // equal version fails with "newer version already installed" (418) after the files are gone.
  async deregister (removed, failures) {
    const gone = new Set(removed.map(x => x.dir))
    const names = new Set(removed.map(x => x.name))
    for (const name of names) {
      if (this.extensions.some(x => x.name === name && !gone.has(x.dir))) continue
      if (!(this.upiaEntries || []).some(u => normalizeName(u.name) === normalizeName(name))) continue
      try {
        await removeUpia(name)
      } catch (err) {
        failures.push(`Adobe installer registration for ${name}: ${err.message}`)
      }
    }
  }

  deepUninstall (ext) {
    const dlg = document.querySelector('#uninstall-dialog')
    const items = findLeftovers(ext, this.extensions)
    const list = dlg.querySelector('.ud-list')
    const total = dlg.querySelector('.ud-total')
    dlg.querySelector('.ud-title').textContent = `Uninstall ${ext.name} ${ext.version || ''}`
    list.innerHTML = items.map((it, i) => `<label class="ud-row"><input type="checkbox" data-i="${i}" ${it.checked ? 'checked' : ''}><span class="grow"><span class="kind">${esc(it.kind)}${it.scope === 'system' ? ' · system (asks for admin password)' : ''}</span><br>${esc(it.path)}</span><span class="sz">${fmtSize(it.size)}</span></label>`).join('')
    const update = () => {
      const picked = items.filter(i => i.checked)
      total.textContent = `${picked.length} of ${items.length} selected · ${fmtSize(picked.reduce((s, i) => s + i.size, 0))}`
    }
    list.onchange = e => {
      items[e.target.dataset.i].checked = e.target.checked; update()
    }
    update()
    dlg.querySelector('.ud-cancel').onclick = () => dlg.close()
    dlg.querySelector('.ud-go').onclick = async () => {
      const failures = []
      for (const it of items.filter(i => i.checked)) {
        try {
          await trashPath(it.path, shell)
        } catch (err) {
          failures.push(`${it.path}: ${err.message}`)
        }
      }
      const removedDirs = new Set(items.filter(i => i.checked).map(i => i.path))
      await this.deregister(this.extensions.filter(x => removedDirs.has(x.dir) || x === ext), failures)
      dlg.close()
      if (failures.length) dialog.showErrorBox('Some items could not be removed', failures.join('\n'))
      this.refresh()
    }
    dlg.showModal()
  }

  async confirm (message, detail) {
    const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['Move to Trash', 'Cancel'], defaultId: 1, cancelId: 1, message, detail })
    return response === 0
  }
}
