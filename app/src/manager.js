import { scanExtensions, detectApps, analyze, summarize, debugModeState, setDebugMode, normalizeName, HOST_NAMES, MAX_CEP_RUNTIME } from './scanner.js'
import { listUpia, removeUpia } from './upia.js'
import { disableExtension, enableExtension, trashPath } from './actions.js'
import { findLeftovers } from './leftovers.js'
import { demoData } from './demo.js'
const { dialog, shell } = require('@electron/remote')

const fmtSize = b => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const AVATAR_COLORS = ['#5b4bf0', '#0e8f6e', '#c2410c', '#0369a1', '#a21caf', '#b45309', '#be123c', '#4d7c0f']
const avatarColor = name => AVATAR_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length]
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

export class Manager {
  constructor () {
    this.extensions = []
    this.apps = []
    this.filter = 'all'
    this.query = ''
    this.loaded = false
    this.list = document.querySelector('#ext-list')
    this.banners = document.querySelector('#banners')
    this.stats = document.querySelector('#stats')

    document.querySelectorAll('.nav-item').forEach(t => t.addEventListener('click', () => this.showTab(t.dataset.tab)))
    document.querySelectorAll('#filters button').forEach(c => c.addEventListener('click', () => {
      this.filter = c.dataset.filter
      document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('is-active', x === c))
      this.render()
    }))
    document.querySelector('#search').addEventListener('input', e => {
      this.query = e.target.value.toLowerCase()
      this.render()
    })
    document.querySelector('#rescan').addEventListener('click', () => this.refresh())
    this.list.addEventListener('click', e => this.onListClick(e))
    this.banners.addEventListener('click', e => this.onInsightClick(e))
    // Populate the sidebar and attention badge right away.
    setTimeout(() => this.refresh(), 200)
  }

  showTab (name) {
    document.body.dataset.tab = name
    document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name))
    for (const v of ['install', 'manage', 'about']) document.querySelector(`#view-${v}`).hidden = v !== name
    if (name === 'manage' && !this.loaded) this.refresh()
  }

  refresh () {
    if (this.scanning) return
    this.scanning = true
    if (!this.loaded) this.list.innerHTML = '<div class="empty">Scanning…</div>'
    // Let the "Scanning…" paint before the synchronous scan.
    setTimeout(async () => {
      const demo = process.env.ZXP_DEMO ? demoData() : null
      this.apps = demo ? demo.apps : detectApps()
      this.extensions = analyze(demo ? demo.extensions : scanExtensions(), this.apps)
      this.debug = demo ? demo.debug : debugModeState()
      this.upiaEntries = demo ? demo.upia : await listUpia()
      this.others = this.unmatched(this.upiaEntries)
      this.loaded = true
      this.scanning = false
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
    this.renderSidebar(s)
    this.stats.innerHTML = [
      ['', s.total, 'Installed'],
      [s.withIssues ? 'warn' : '', s.withIssues, 'Need attention'],
      ['', s.disabled, 'Disabled'],
      ['', fmtSize(s.totalBytes), 'On disk'],
    ].map(([cls, n, label]) => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`).join('')

    const cards = []
    if (s.cleanup.length) {
      cards.push(`<div class="banner warn"><div class="grow"><strong>${plural(s.cleanup.length, 'safe cleanup suggestion')}</strong> (${fmtSize(s.cleanupBytes)}). Outdated versions, duplicates, or extensions that target no installed app. Removed items go to the Trash.</div><button class="btn sm" data-do="review">Review &amp; clean up</button></div>`)
    }
    const dbg = (this.debug || []).filter(d => d.on).map(d => d.version)
    const unsigned = this.extensions.filter(e => !e.signed && !e.adobeManaged && !e.error).length
    if (dbg.length) {
      cards.push(`<div class="banner"><div class="grow"><strong>CEP debug mode is on</strong> (CSXS ${dbg.join(', ')}). Unsigned extensions load, and so could anything else dropped into the extensions folder${unsigned ? `. ${plural(unsigned, 'installed extension is', 'installed extensions are')} unsigned and would stop loading if you turn it off` : ''}.</div><button class="btn sm" data-do="debug-off">Turn off</button></div>`)
    } else if (unsigned) {
      cards.push(`<div class="banner"><div class="grow"><strong>${plural(unsigned, 'extension is', 'extensions are')} unsigned</strong> and need CEP debug mode (CSXS 9–${MAX_CEP_RUNTIME}) to load. It is currently off.</div><button class="btn sm" data-do="debug-on">Turn on</button></div>`)
    }
    this.banners.innerHTML = cards.join('')

    const rows = this.visible()
    const others = this.othersHtml()
    this.list.innerHTML = rows.length || others ? rows.map(e => this.row(e)).join('') + others : '<div class="empty">No extensions match.</div>'
  }

  renderSidebar (s) {
    const badge = document.querySelector('#nav-count')
    badge.hidden = !s.withIssues
    badge.textContent = s.withIssues
    const seen = new Set()
    const apps = this.apps.filter(a => !seen.has(a.name) && seen.add(a.name))
    document.querySelector('#side-apps').innerHTML = apps.length
      ? apps.map(a => `<li><span>${esc(a.name)}</span><span class="v">${esc(a.version ? String(a.version).split('.').slice(0, 2).join('.') : '')}</span></li>`).join('')
      : '<li class="muted">No Adobe apps found</li>'
  }

  othersHtml () {
    const others = this.filter === 'all' ? (this.others || []).filter(o => !this.query || o.name.toLowerCase().includes(this.query)) : []
    if (!others.length) return ''
    return '<div class="section-title">Registered with Adobe\'s installer but no CEP folder found (UXP plugins, or leftovers that block reinstalls)</div>' + others.map((o, i) => `<div class="ext" data-o="${i}">
      <div class="avatar" style="background:${avatarColor(o.name)}">${esc(o.name[0].toUpperCase())}</div>
      <div class="ext-main">
        <div class="ext-name">${esc(o.name)}<span class="v">v${esc(o.version)}</span></div>
        <div class="ext-meta"><span class="badge">${esc(o.status.toLowerCase())}</span><span>${esc([...new Set(o.products)].join(', '))}</span></div>
      </div>
      <div class="ext-actions"><button class="btn sm danger" data-do="remove-other">Remove</button></div>
    </div>`).join('')
  }

  row (e) {
    const hosts = [...new Set(e.hosts.map(h => HOST_NAMES[h.name] || h.name))]
    const idx = this.extensions.indexOf(e)
    const protectedExt = e.adobeManaged
    return `<div class="ext ${e.enabled ? '' : 'is-disabled'}" data-i="${idx}">
      <div class="avatar" style="background:${avatarColor(e.name)}">${esc(e.name[0].toUpperCase())}</div>
      <div class="ext-main">
        <div class="ext-name">${esc(e.name)}<span class="v">v${esc(e.version || '?')}</span></div>
        <div class="ext-meta">
          <span>${esc(hosts.join(', ') || 'no host info')}</span>
          <span>${fmtSize(e.size)}</span>
          <span>${e.scope === 'system' ? 'All users' : 'This user'}</span>
          ${protectedExt ? '<span class="badge managed">Creative Cloud</span>' : ''}
          ${e.enabled ? '' : '<span class="badge">disabled</span>'}
        </div>
        ${e.issues.map(i => `<div class="issue ${i.level}">${esc(i.message)}</div>`).join('')}
      </div>
      <div class="ext-actions">
        <button class="btn sm" data-do="reveal">Reveal</button>
        ${protectedExt ? '' : `<button class="btn sm" data-do="${e.enabled ? 'disable' : 'enable'}">${e.enabled ? 'Disable' : 'Enable'}</button><button class="btn sm danger" data-do="uninstall">Uninstall…</button>`}
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
        response === 0 ? await trashPath(e.dir, shell) : await disableExtension(e)
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
