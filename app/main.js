const { app, BrowserWindow } = require('electron')
const path = require('path')
const remote = require('@electron/remote/main')

remote.initialize()

// Quit when all windows are closed.
app.on('window-all-closed', () => app.quit())

// This method will be called when Electron has done everything
// initialization and ready for creating browser windows.
app.whenReady().then(() => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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

  // Open the devtools.
  // mainWindow.openDevTools();
})
