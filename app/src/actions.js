// Reversible management actions. Nothing is hard-deleted: removal goes to the Trash.
import { disabledDirFor } from './scanner.js'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

function canWrite (p) {
  try {
    fs.accessSync(p, fs.constants.W_OK); return true
  } catch {
    return false
  }
}

function run (cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  })
}

const shQuote = s => `'${String(s).replace(/'/g, "'\\''")}'`

// macOS: run a shell script with a native admin password prompt.
function runPrivileged (script) {
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('Administrator rights are required. Re-run the app as administrator.'))
  }
  const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return run('osascript', ['-e', `do shell script "${escaped}" with administrator privileges`])
}

async function move (src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (canWrite(path.dirname(src))) {
    fs.renameSync(src, dest)
  } else if (process.platform === 'darwin') {
    // Created by root, then handed back so later moves don't need a prompt.
    await runPrivileged(`mkdir -p ${shQuote(path.dirname(dest))} && mv ${shQuote(src)} ${shQuote(dest)}`)
  } else {
    throw new Error('Administrator rights are required to modify this extension.')
  }
}

export async function disableExtension (ext) {
  if (!ext.enabled) return
  const dest = path.join(disabledDirFor(ext.root), ext.folder)
  fs.mkdirSync(disabledDirFor(ext.root), { recursive: true })
  await move(ext.dir, dest)
}

export async function enableExtension (ext) {
  if (ext.enabled) return
  const dest = path.join(ext.root, ext.folder)
  if (fs.existsSync(dest)) throw new Error('An extension with this folder name is already enabled.')
  await move(ext.dir, dest)
}

export async function removeExtension (ext, shell) {
  if (canWrite(path.dirname(ext.dir))) {
    await shell.trashItem(ext.dir)
  } else {
    const trash = path.join(os.homedir(), '.Trash', `${ext.folder} ${Date.now()}`)
    await move(ext.dir, trash)
  }
}
