// Reads and removes extensions through Adobe's Unified Plugin Installer Agent,
// which also knows about UXP plugins that live outside the CEP folders.
import { getUpiaPath } from './installer.js'
const { execFile } = require('child_process')

function run (args) {
  const upia = getUpiaPath()
  return new Promise((resolve, reject) => {
    if (!upia) return reject(new Error('Adobe Unified Plugin Installer Agent not found'))
    execFile(upia, args, { timeout: 60000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  })
}

// Output: "2 extensions installed for Photoshop 2026 (ver 27.10.0)" then rows of
// "<Status>  <Name>  <Version>".
export function parseList (text) {
  const entries = []
  let product = null
  for (const raw of text.split('\n')) {
    const head = /installed for (.+?) \(ver ([^)]+)\)/.exec(raw)
    if (head) {
      product = head[1]
      continue
    }
    const row = /^\s*(Enabled|Disabled)\s+(.+?)\s{2,}(\S+)\s*$/.exec(raw)
    if (row && product) entries.push({ status: row[1], name: row[2].trim(), version: row[3], product })
  }
  return entries
}

export async function listUpia () {
  try {
    return parseList(await run(['--list', 'all']))
  } catch {
    return []
  }
}

export async function removeUpia (name) {
  const out = await run(['--remove', name])
  if (/\b(fail(ed)?|error)\b/i.test(out)) throw new Error(out.trim().split('\n').pop())
}
