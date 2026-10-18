// Finds everything an extension leaves behind, matched strictly by its bundle id and
// panel ids (never by fuzzy name), so a deep uninstall can't touch unrelated data.
const fs = require('fs')
const os = require('os')
const path = require('path')

const isMac = process.platform === 'darwin'

function sizeOf (p) {
  let total = 0
  const stack = [p]
  while (stack.length) {
    const cur = stack.pop()
    let st
    try {
      st = fs.lstatSync(cur)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      try {
        for (const f of fs.readdirSync(cur)) stack.push(path.join(cur, f))
      } catch {}
    } else {
      total += st.size
    }
  }
  return total
}

function list (dir) {
  try {
    return fs.readdirSync(dir).map(name => ({ name, full: path.join(dir, name) }))
  } catch {
    return []
  }
}

// "com.foo.bar", "com.foo.bar.plist", "com.foo.bar.Helper.plist" match id "com.foo.bar";
// "com.foo.bar2" does not.
function hasIdPrefix (name, id) {
  const n = name.toLowerCase()
  const i = id.toLowerCase()
  return n === i || (n.startsWith(i) && /^[._ -]/.test(n.slice(i.length)))
}

export function findLeftovers (ext, allExtensions) {
  const ids = [...new Set([ext.bundleId, ...(ext.panelIds || [])].filter(Boolean))]
  const items = []
  const add = (p, kind, scope = 'user') => {
    if (!items.some(i => i.path === p)) items.push({ path: p, kind, scope, size: sizeOf(p), checked: true })
  }

  // Every installed copy of this extension (other versions, disabled, system-level).
  if (ext.bundleId) {
    for (const other of allExtensions) {
      if (other.bundleId === ext.bundleId && !other.adobeManaged) add(other.dir, other === ext ? 'Extension' : 'Other copy of this extension', other.scope)
    }
  } else {
    add(ext.dir, 'Extension', ext.scope)
  }
  if (!ids.length || !isMac) return items.sort((a, b) => a.kind.localeCompare(b.kind))

  const lib = path.join(os.homedir(), 'Library')
  for (const { name, full } of list(path.join(lib, 'Caches/CSXS/cep_cache'))) {
    // <HOST>_<version>_<panelId>
    if (ids.some(id => new RegExp(`^[A-Z]+_[\\d.]+_${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(name))) add(full, 'CEP panel cache')
  }
  for (const { name, full } of list(path.join(lib, 'Logs/CSXS'))) {
    if (ids.some(id => name.toLowerCase().includes(`-${id.toLowerCase()}.`) || name.toLowerCase().includes(`-${id.toLowerCase()}-`))) add(full, 'CEP log')
  }
  const spots = [
    ['Preferences', 'Preferences'],
    ['Caches', 'Cache'],
    ['Application Support', 'Application data'],
    ['Saved Application State', 'Saved state'],
    ['Logs', 'Log'],
    ['HTTPStorages', 'Network storage'],
    ['WebKit', 'Web storage'],
  ]
  for (const [dir, kind] of spots) {
    for (const { name, full } of list(path.join(lib, dir))) {
      if (ids.some(id => hasIdPrefix(name, id))) add(full, kind)
    }
  }
  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
}
