import { Installer } from './installer.js'
import { UIMessages } from './messages.js'
import { Manager } from './manager.js'
const { dialog, shell } = require('@electron/remote')
const { ipcRenderer, webUtils } = require('electron')

class View {
  constructor (view) {
    this.view = view
    this.installer = new Installer()
    this.zxpPath = null

    for (const a of document.querySelectorAll('a[target=_blank]')) {
      a.addEventListener('click', e => {
        e.preventDefault()
        shell.openExternal(a.href)
      })
    }

    // Count enter/leave so moving over child elements doesn't flicker the drop state.
    let depth = 0
    const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const endDrag = () => {
      depth = 0
      document.body.classList.remove('drop-active')
      this.view.classList.toggle('is-dragging', false)
      this.updateStatus(UIMessages.dragToInstall)
    }

    document.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      document.body.classList.add('drop-active')
      this.view.classList.toggle('is-dragging', true)
      this.updateStatus(UIMessages.dropToInstall)
    })

    document.addEventListener('dragover', e => {
      if (hasFiles(e)) e.preventDefault()
    })

    document.addEventListener('dragleave', e => {
      if (!hasFiles(e)) return
      if (--depth <= 0) endDrag()
    })

    document.addEventListener('drop', e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      endDrag()
      // File.path was removed in Electron 32; webUtils is the replacement.
      this.queueInstall([...e.dataTransfer.files].map(f => webUtils.getPathForFile(f)))
    })

    document.querySelector('.main-view').addEventListener('click', async () => {
      const { filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Adobe extensions', extensions: ['zxp', 'ccx'] }, { name: 'All files', extensions: ['*'] }],
      })
      if (filePaths.length) this.queueInstall(filePaths)
      return false
    })

    ipcRenderer.on('open-files', (e, paths) => this.queueInstall(paths))

    this.updateStatus(UIMessages.dragToInstall)
  }

  resetClasses () {
    for (const cls of ['is-showing-spinner', 'was-successful', 'is-dragging', 'has-error']) {
      this.view.classList.toggle(cls, false)
    }
  }

  updateStatus (message) {
    document.querySelector('.status').innerText = message
  }

  toggleSpinner (state) {
    this.resetClasses()
    this.view.classList.toggle('is-showing-spinner', state)
  }

  toggleSuccess (state) {
    this.resetClasses()
    this.view.classList.toggle('was-successful', state)
  }

  startInstalling () {
    this.updateStatus(UIMessages.installing)
    this.toggleSpinner(true)
  }

  installationFailed (err) {
    this.toggleSpinner(false)
    this.updateStatus(err?.message ?? err)
  }

  installationSuccess () {
    this.toggleSpinner(false)
    this.toggleSuccess(true)
    this.updateStatus(UIMessages.installed)
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
    const log = document.querySelector('#install-log')
    let done = 0
    let failed = 0
    let total = this.pending.length
    while (this.pending.length) {
      const file = this.pending.shift()
      total = Math.max(total, done + failed + 1 + this.pending.length)
      const li = document.createElement('li')
      li.innerHTML = '<span class="nm"></span><span class="wait">waiting…</span>'
      li.querySelector('.nm').textContent = require('path').basename(file)
      li.title = file
      log.prepend(li)
      const result = li.querySelector('span:last-child')
      if (!/\.(zxp|ccx)$/i.test(file)) {
        result.className = 'fail'
        result.textContent = 'not a .zxp or .ccx file'
        failed++
        continue
      }
      this.zxpPath = file
      this.updateStatus(total > 1 ? `Installing ${done + failed + 1} of ${total}…` : UIMessages.installing)
      this.toggleSpinner(true)
      try {
        await this.installer.install(file)
        result.className = 'ok'
        result.textContent = 'installed'
        done++
      } catch (err) {
        result.className = 'fail'
        result.textContent = err?.message ?? String(err)
        result.title = result.textContent
        failed++
      }
    }
    this.busy = false
    this.toggleSpinner(false)
    if (failed) {
      this.view.classList.toggle('has-error', true)
      this.updateStatus(done ? `${done} installed, ${failed} failed` : (failed > 1 ? `${failed} installs failed` : document.querySelector('#install-log li span:last-child').textContent))
    } else {
      this.toggleSuccess(true)
      this.updateStatus(done > 1 ? `${done} extensions installed` : UIMessages.installed)
    }
    window.manager.loaded = false
  }
}

window.view = new View(document.body)
window.manager = new Manager()
