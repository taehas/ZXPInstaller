import { Installer } from './installer.js'
import { Manager } from './manager.js'
const { dialog, shell, app } = require('@electron/remote')
const { ipcRenderer, webUtils } = require('electron')
const path = require('path')

const STATES = {
  idle: ['Drop extensions here', 'or click to choose files. You can drop several at once.'],
  drag: ['Drop to install', 'Release to install these extensions.'],
  working: ['Installing…', 'Adobe\'s installer is working. This takes a few seconds.'],
  success: ['Installed', 'Restart your Adobe apps to load the new extension.'],
  error: ['Something went wrong', 'See the details below.'],
}

class InstallView {
  constructor () {
    this.installer = new Installer()
    this.zone = document.querySelector('#dropzone')
    this.log = document.querySelector('#install-log')
    this.busy = false
    this.pending = []

    document.querySelectorAll('a[target=_blank]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault()
      shell.openExternal(a.href)
    }))

    // Count enter/leave so moving over child elements doesn't flicker the drop state.
    let depth = 0
    const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const endDrag = () => {
      depth = 0
      document.body.classList.remove('drop-active')
      if (!this.busy) this.setState(this.zone.dataset.prev || 'idle')
    }
    document.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (depth++ === 0) this.zone.dataset.prev = this.zone.dataset.state
      document.body.classList.add('drop-active')
      if (!this.busy) this.setState('drag')
    })
    document.addEventListener('dragover', e => hasFiles(e) && e.preventDefault())
    document.addEventListener('dragleave', e => hasFiles(e) && --depth <= 0 && endDrag())
    document.addEventListener('drop', e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      document.body.classList.remove('drop-active')
      // File.path was removed in Electron 32; webUtils is the replacement.
      this.queueInstall([...e.dataTransfer.files].map(f => webUtils.getPathForFile(f)))
    })

    const choose = async () => {
      const { filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Adobe extensions', extensions: ['zxp', 'ccx'] }, { name: 'All files', extensions: ['*'] }],
      })
      if (filePaths.length) this.queueInstall(filePaths)
    }
    this.zone.addEventListener('click', choose)
    this.zone.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose()))

    ipcRenderer.on('open-files', (e, paths) => this.queueInstall(paths))
    this.setState('idle')
  }

  setState (state, title, sub) {
    const [t, s] = STATES[state]
    this.zone.dataset.state = state === 'drag' ? 'idle' : state
    document.querySelector('#dz-title').textContent = title ?? t
    document.querySelector('#dz-sub').textContent = sub ?? s
  }

  // Installs files one after another, logging each result under the drop zone.
  async queueInstall (paths) {
    window.manager.showTab('install')
    if (this.busy) {
      this.pending.push(...paths)
      return
    }
    this.busy = true
    this.pending = [...paths]
    document.querySelector('#log-h').hidden = false
    let done = 0
    let failed = 0
    let total = this.pending.length
    let lastError = ''
    while (this.pending.length) {
      const file = this.pending.shift()
      total = Math.max(total, done + failed + 1 + this.pending.length)
      const li = document.createElement('li')
      li.innerHTML = '<span class="nm"></span><span class="res wait">waiting…</span>'
      li.querySelector('.nm').textContent = path.basename(file)
      li.title = file
      this.log.prepend(li)
      const result = li.querySelector('.res')
      if (!/\.(zxp|ccx)$/i.test(file)) {
        result.className = 'res fail'
        result.textContent = 'not a .zxp or .ccx file'
        lastError = result.textContent
        failed++
        continue
      }
      this.setState('working', total > 1 ? `Installing ${done + failed + 1} of ${total}…` : undefined)
      try {
        await this.installer.install(file)
        result.className = 'res ok'
        result.textContent = 'installed'
        done++
      } catch (err) {
        result.className = 'res fail'
        result.textContent = lastError = err?.message ?? String(err)
        result.title = result.textContent
        failed++
      }
    }
    this.busy = false
    if (!failed) {
      this.setState('success', done > 1 ? `${done} extensions installed` : undefined)
    } else if (done) {
      this.setState('error', `${done} installed, ${failed} failed`, 'See the details below.')
    } else {
      this.setState('error', failed > 1 ? `${failed} installs failed` : 'Install failed', lastError)
    }
    window.manager.loaded = false
    if (document.body.dataset.tab === 'manage') window.manager.refresh()
  }
}

window.installView = new InstallView()
window.manager = new Manager()
document.querySelector('#ver').textContent = 'v' + app.getVersion()
