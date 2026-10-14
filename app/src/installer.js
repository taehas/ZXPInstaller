import { getErrorMessage } from './messages.js'
const { spawn, execFileSync } = require('child_process')
const path = require('path')

const CMD_PREFIX = process.platform === 'darwin' ? '--' : '/'
const fs = require('fs')

// Adobe's Unified Plugin Installer Agent ships with Creative Cloud, is a native
// arm64/x64 build, and installs both .zxp and .ccx. Prefer it over the bundled
// (Intel-only, 2021-era) ExManCmd.
export function getUpiaPath () {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Common Files', 'Adobe', 'Adobe Desktop Common', 'RemoteComponents', 'UPI', 'UnifiedPluginInstallerAgent', 'UnifiedPluginInstallerAgent.exe')]
    : ['/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent']
  return candidates.find(p => fs.existsSync(p)) ?? null
}

function getExManCmdPath () {
  if (process.platform === 'win32') {
    return 'bin/windows/ExManCmd.exe'
  } else {
    return 'bin/mac/Contents/MacOS/ExManCmd'
  }
}

// For a -410 ("no CSXS/manifest.xml"), look inside the archive and say what it really is.
export function diagnoseArchive (file) {
  let names
  try {
    names = execFileSync('tar', ['-tf', file], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString().split('\n').filter(Boolean)
  } catch {
    return 'It is not a readable zip archive.'
  }
  const nested = names.filter(n => /\.(zxp|ccx|pkg|dmg|exe|msi)$/i.test(n)).slice(0, 3)
  if (nested.length) return `It is a wrapper that contains other installers (${nested.join(', ')}). Extract it and install the inner file instead.`
  if (names.some(n => /(^|\/)manifest\.json$/i.test(n))) return 'It looks like a UXP plugin package (manifest.json). Rename or install it as a .ccx instead.'
  if (names.some(n => /(^|\/)CSXS\/manifest\.xml$/i.test(n)) === false && names.some(n => /(^|\/)[^/]+\/CSXS\/manifest\.xml$/i.test(n))) {
    return 'The extension is nested inside an extra folder. The CSXS folder must be at the top level of the archive; re-zip it from inside that folder.'
  }
  return `No CSXS/manifest.xml found. Top-level contents: ${[...new Set(names.map(n => n.split('/')[0]))].slice(0, 5).join(', ')}.`
}

export class Installer {
  install (zxpPath) {
    const upia = getUpiaPath()
    return upia ? this.installWithUpia(upia, zxpPath) : this.installWithExMan(zxpPath)
  }

  installWithUpia (upia, extPath) {
    console.log('installing with UPIA: ' + extPath)
    return new Promise((resolve, reject) => {
      let output = ''
      const child = spawn(upia, ['--install', extPath])
      child.stdout.on('data', d => {
        output += d.toString()
      })
      child.stderr.on('data', d => {
        output += d.toString()
      })
      child.on('error', e => reject(e))
      child.on('exit', code => {
        const failed = code !== 0 || /\b(fail(ed)?|error)\b/i.test(output)
        if (!failed) return resolve()
        // UPIA exits 0 even on failure and reports e.g. "Failed to install, status = -410!"
        const status = /status = -?(\d+)/.exec(output)?.[1]
        const line = output.split('\n').map(l => l.trim()).filter(Boolean).pop()
        const known = status ? getErrorMessage(parseInt(status)) : null
        if (known) return reject(new Error(status === '410' ? `${known} ${diagnoseArchive(extPath)}` : known))
        if (status) return reject(new Error(`Adobe's installer failed with error ${status}. ${line}`))
        const fallback = `Installer exited with code ${code}`
        reject(new Error(line ?? fallback))
      })
    })
  }

  installWithExMan (zxpPath) {
    console.log('using target path of ' + getExManCmdPath())
    console.log('starting to install ZXP from path ' + zxpPath)

    return new Promise(function (resolve, reject) {
      let closeMessage = ''

      const childProcess = spawn(path.join(__dirname, getExManCmdPath()), [
        CMD_PREFIX + 'install',
        zxpPath,
      ])

      childProcess.stdout.on('data', function (data) {
        console.log('stdout: ' + data.toString())
        const logbits = /= -(\d+)/.exec(data.toString())
        const code = logbits?.[1] ? parseInt(logbits[1]) : null
        if (code) {
          closeMessage = getErrorMessage(code) ?? 'Error: ' + data.toString()
        }
      })

      childProcess.stderr.on('data', function (data) {
        console.log('stderr: ' + data.toString())
        const logbits = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) : ([A-Z]+)\s+(.*)/.exec(
          data.toString()
        )
        const [_, __, ___, level, message] = logbits ?? []
        if (level === 'ERROR') {
          reject(message)
        }
      })

      // code 0 => success
      childProcess.on('exit', code => {
        if (code === 0) {
          resolve()
        } else {
          reject(closeMessage)
        }
      })
    })
  }
}
