const { app, BrowserWindow } = require('electron')
const path = require('path')
const remote = require('@electron/remote/main')

remote.initialize()

let mainWindow = null
let rendererReady = false
const pendingFiles = []
const isInstallable = f => /\.(zxp|ccx)$/i.test(f)

function openFiles (files) {
  const list = files.filter(isInstallable)
  if (!list.length) return
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send('open-files', list)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else {
    pendingFiles.push(...list)
  }
}

// macOS: files dropped on the Dock icon or opened via file association.
app.on('open-file', (event, file) => {
  event.preventDefault()
  openFiles([file])
})

// Windows/Linux: a second launch with a file argument goes to the running window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => openFiles(argv.slice(1)))
}
pendingFiles.push(...process.argv.slice(app.isPackaged ? 1 : 2).filter(isInstallable))

// Quit when all windows are closed.
app.on('window-all-closed', () => app.quit())

// This method will be called when Electron has done everything
// initialization and ready for creating browser windows.
app.whenReady().then(() => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 700,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  })

  // and load the index.html of the app.
  mainWindow.loadFile(path.resolve(__dirname, 'index.html'))

  remote.enable(mainWindow.webContents)

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    if (pendingFiles.length) mainWindow.webContents.send('open-files', pendingFiles.splice(0))
  })

  // Open the devtools.
  // mainWindow.openDevTools();
})
