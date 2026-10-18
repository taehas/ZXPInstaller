// Discovers installed CEP extensions and Adobe apps, then analyses them.
// Pure Node (fs/path/os/child_process); manifest parsing uses the renderer's DOMParser.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

// Newest CEP runtime shipped with current Creative Cloud apps.
export const MAX_CEP_RUNTIME = 12

export const HOST_NAMES = {
  AEFT: 'After Effects',
  PHXS: 'Photoshop',
  PHSP: 'Photoshop',
  ILST: 'Illustrator',
  IDSN: 'InDesign',
  PPRO: 'Premiere Pro',
  AUDT: 'Audition',
  AME: 'Media Encoder',
  KBRG: 'Bridge',
  FLPR: 'Animate',
  DRWV: 'Dreamweaver',
  PRLD: 'Prelude',
  MUSE: 'Muse',
  IDSN_: 'InDesign Server',
}

// Host ids for each app name prefix we recognise on disk.
const APP_PREFIXES = [
  ['After Effects', ['AEFT']],
  ['Photoshop', ['PHXS', 'PHSP']],
  ['Illustrator', ['ILST']],
  ['InDesign', ['IDSN']],
  ['Premiere Pro', ['PPRO']],
  ['Audition', ['AUDT']],
  ['Media Encoder', ['AME']],
  ['Bridge', ['KBRG']],
  ['Animate', ['FLPR']],
  ['Dreamweaver', ['DRWV']],
]

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

export function extensionRoots () {
  if (isWin) {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    return [
      { scope: 'user', dir: path.join(process.env.APPDATA || '', 'Adobe', 'CEP', 'extensions') },
      { scope: 'system', dir: path.join(pf86, 'Common Files', 'Adobe', 'CEP', 'extensions') },
    ]
  }
  return [
    { scope: 'user', dir: path.join(os.homedir(), 'Library/Application Support/Adobe/CEP/extensions') },
    { scope: 'system', dir: '/Library/Application Support/Adobe/CEP/extensions' },
  ]
}

export function disabledDirFor (root) {
  return path.join(path.dirname(root), 'extensions.disabled')
}

// ---------- version helpers ----------

export function parseVersion (v) {
  return String(v ?? '').split(/[.\-_]/).map(p => parseInt(p, 10)).filter(n => !isNaN(n))
}

export function compareVersions (a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

// "[13.0,99.9]" => {min,max}; "13.0" => {min, max: Infinity}
export function parseHostRange (v) {
  const m = /^[[(]\s*([\d.]*)\s*,\s*([\d.]*)\s*[\])]$/.exec((v ?? '').trim())
  if (m) return { min: parseFloat(m[1]) || 0, max: m[2] ? parseFloat(m[2]) : Infinity }
  return { min: parseFloat(v) || 0, max: Infinity }
}

// Strip trailing version noise so "flow-v1.4.2" and "flow-v1.5.2" group together.
export function normalizeName (s) {
  return String(s ?? '').toLowerCase()
    .replace(/[-_ ]v?\d+([._]\d+)*$/, '')
    .replace(/[^a-z0-9]+/g, '')
}

function versionFromFolder (name) {
  const m = /[-_ ]v?(\d+(?:[._]\d+)*)$/.exec(name)
  return m ? m[1].replace(/_/g, '.') : null
}

// ---------- installed Adobe apps ----------

export function detectApps () {
  const apps = []
  try {
    if (isMac) {
      for (const entry of fs.readdirSync('/Applications')) {
        if (!entry.startsWith('Adobe ')) continue
        const match = APP_PREFIXES.find(([n]) => entry.includes(n))
        if (!match) continue
        // Leftover folders from uninstalled versions have no .app; skip them.
        const dir = path.join('/Applications', entry)
        const bundles = fs.readdirSync(dir).filter(f => f.endsWith('.app') && !/Render Engine|Uninstall/.test(f))
        if (!bundles.length) continue
        const plist = path.join(dir, bundles.sort((a, b) => (a === `${entry}.app` ? -1 : b === `${entry}.app` ? 1 : 0))[0], 'Contents/Info.plist')
        let version = null
        try {
          const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
          version = json.CFBundleShortVersionString
        } catch {}
        apps.push({ name: entry.replace(/^Adobe /, ''), family: match[0], hosts: match[1], version, major: parseFloat(version) || null })
      }
    } else if (isWin) {
      const dirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
      for (const d of dirs) {
        const adobe = path.join(d, 'Adobe')
        if (!fs.existsSync(adobe)) continue
        for (const entry of fs.readdirSync(adobe)) {
          const match = APP_PREFIXES.find(([n]) => entry.includes(n))
          if (match) apps.push({ name: entry.replace(/^Adobe /, ''), family: match[0], hosts: match[1], version: null, major: null })
        }
      }
    }
  } catch {}
  return apps
}

// ---------- manifest parsing ----------

function dirSize (dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size
        } catch {}
      }
    }
  }
  return total
}

function parseManifest (xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('manifest.xml is not valid XML')
  const root = doc.documentElement
  const runtimes = [...doc.querySelectorAll('RequiredRuntime')].map(r => ({
    name: r.getAttribute('Name'),
    version: parseFloat(r.getAttribute('Version')) || 0,
  }))
  const hosts = [...doc.querySelectorAll('HostList > Host')].map(h => ({
    name: h.getAttribute('Name'),
    ...parseHostRange(h.getAttribute('Version')),
  }))
  const panelIds = [...doc.querySelectorAll('ExtensionList > Extension')].map(x => x.getAttribute('Id')).filter(Boolean)
  return {
    panelIds,
    bundleId: root.getAttribute('ExtensionBundleId'),
    bundleVersion: root.getAttribute('ExtensionBundleVersion'),
    bundleName: root.getAttribute('ExtensionBundleName'),
    hosts,
    runtimes,
  }
}

export function readExtension (dir, scope, enabled) {
  const folder = path.basename(dir)
  const ext = {
    folder,
    dir,
    scope,
    enabled,
    size: 0,
    mtime: 0,
    bundleId: null,
    name: folder,
    version: versionFromFolder(folder),
    hosts: [],
    runtimes: [],
    panelIds: [],
    signed: false,
    adobeManaged: false,
    error: null,
  }
  try {
    ext.mtime = fs.statSync(dir).mtimeMs
  } catch {}
  ext.size = dirSize(dir)
  ext.signed = fs.existsSync(path.join(dir, 'META-INF', 'signatures.xml'))
  try {
    const m = parseManifest(fs.readFileSync(path.join(dir, 'CSXS', 'manifest.xml'), 'utf8'))
    ext.bundleId = m.bundleId
    ext.name = m.bundleName || m.bundleId || folder
    ext.version = m.bundleVersion || ext.version
    ext.hosts = m.hosts
    ext.runtimes = m.runtimes
    ext.panelIds = m.panelIds
  } catch (e) {
    ext.error = e.code === 'ENOENT' ? 'Missing CSXS/manifest.xml' : e.message
  }
  ext.adobeManaged = /^com\.adobe\./i.test(ext.bundleId || '') || /^CC_LIBRARIES/i.test(folder) || /^com\.adobe\./i.test(folder)
  return ext
}

export function scanExtensions () {
  const list = []
  for (const { scope, dir } of extensionRoots()) {
    for (const [base, enabled] of [[dir, true], [disabledDirFor(dir), false]]) {
      let entries
      try {
        entries = fs.readdirSync(base, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue
        if (e.name.startsWith('.')) continue
        const ext = readExtension(path.join(base, e.name), scope, enabled)
        ext.root = dir
        list.push(ext)
      }
    }
  }
  return list
}

// Is CEP PlayerDebugMode on? Needed to run unsigned extensions.
export function debugModeState () {
  const versions = []
  for (let v = 9; v <= MAX_CEP_RUNTIME; v++) {
    let on = false
    try {
      if (isMac) {
        on = execFileSync('defaults', ['read', `com.adobe.CSXS.${v}`, 'PlayerDebugMode'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === '1'
      } else if (isWin) {
        const out = execFileSync('reg', ['query', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
        on = /\s1\s*$/m.test(out.trim())
      }
    } catch {}
    versions.push({ version: v, on })
  }
  return versions
}

// ---------- analysis ----------

// Each issue: { level: 'warn'|'info'|'error', code, message }
// Plus ext.suggestRemove (reason string) for safe cleanup candidates.
export function analyze (extensions, apps) {
  const installedHosts = new Set(apps.flatMap(a => a.hosts))
  const active = extensions.filter(e => e.enabled)

  for (const e of extensions) {
    e.issues = []; e.suggestRemove = null
  }

  // Group by bundle id, then by normalised name, to find superseded versions.
  const groups = new Map()
  for (const e of active) {
    const key = e.bundleId ? 'id:' + e.bundleId : 'name:' + normalizeName(e.folder)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(e)
  }
  // Merge id-less/odd-id groups sharing a normalised name (e.g. flow-v1.4.2 vs flow-v1.5.2).
  const byName = new Map()
  for (const list of groups.values()) {
    const n = normalizeName(list[0].name !== list[0].folder ? list[0].name : list[0].folder)
    if (!n) continue
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n).push(...list)
  }
  for (const list of byName.values()) {
    if (list.length < 2) continue
    const newest = list.reduce((a, b) => (compareVersions(a.version, b.version) >= 0 ? a : b))
    for (const e of list) {
      if (e === newest) continue
      if (compareVersions(e.version, newest.version) === 0 && e.mtime >= newest.mtime) continue
      const sameVersion = compareVersions(e.version, newest.version) === 0
      e.issues.push({
        level: 'warn',
        code: sameVersion ? 'duplicate' : 'superseded',
        message: sameVersion ? `Duplicate of ${newest.folder} (same version)` : `Superseded by ${newest.version || 'newer copy'} (${newest.folder})`,
      })
      // Same-version copies with different bundle ids are flagged but not auto-suggested.
      if (!e.adobeManaged && (!sameVersion || e.bundleId === newest.bundleId)) e.suggestRemove = sameVersion ? 'Duplicate copy' : 'Older version of an installed extension'
    }
  }

  for (const e of extensions) {
    if (e.error) e.issues.push({ level: 'error', code: 'broken', message: e.error })

    const hostNames = e.hosts.map(h => h.name)
    if (e.hosts.length && apps.length) {
      const matching = e.hosts.filter(h => installedHosts.has(h.name))
      if (!matching.length) {
        e.issues.push({ level: 'info', code: 'no-host', message: `Targets ${hostNames.map(n => HOST_NAMES[n] || n).join(', ')}; none installed` })
        if (!e.adobeManaged && !e.suggestRemove) e.suggestRemove = 'Targets no installed Adobe app'
      } else {
        const compatible = matching.some(h => apps.some(a => a.hosts.includes(h.name) && (a.major == null || (a.major >= h.min && a.major <= h.max))))
        if (!compatible) {
          e.issues.push({ level: 'warn', code: 'host-version', message: 'Declared host version range excludes your installed app version(s)' })
        }
      }
    }

    for (const r of e.runtimes) {
      if (r.name === 'CSXS' && r.version > MAX_CEP_RUNTIME) {
        e.issues.push({ level: 'error', code: 'runtime', message: `Requires CEP ${r.version}, newest available is ${MAX_CEP_RUNTIME}` })
      }
    }

    if (!e.signed && !e.adobeManaged && !e.error) {
      e.issues.push({ level: 'info', code: 'unsigned', message: 'Unsigned; only loads while CEP debug mode is enabled' })
    }
  }
  return extensions
}

export function summarize (extensions) {
  const cleanup = extensions.filter(e => e.suggestRemove)
  return {
    total: extensions.length,
    disabled: extensions.filter(e => !e.enabled).length,
    withIssues: extensions.filter(e => e.issues.some(i => i.level !== 'info')).length,
    cleanup,
    cleanupBytes: cleanup.reduce((s, e) => s + e.size, 0),
    totalBytes: extensions.reduce((s, e) => s + e.size, 0),
  }
}

export function setDebugMode (on) {
  for (let v = 9; v <= MAX_CEP_RUNTIME; v++) {
    if (isMac) {
      execFileSync('defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '-string', on ? '1' : '0'])
    } else if (isWin) {
      execFileSync('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', on ? '1' : '0', '/f'])
    }
  }
}
