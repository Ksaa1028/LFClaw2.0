const fs = require('node:fs')
const cp = require('node:child_process')
const path = require('node:path')

const root = __dirname
let patch = ''
for (const rel of ['lib/engine/access.js', 'src/engine/access.ts', 'lib/client.js']) {
  const result = cp.spawnSync('git', ['diff', '--no-index', '--', `original/${rel}`, `modified/${rel}`], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr)
  patch += result.stdout.replaceAll(`a/original/${rel}`, `a/${rel}`).replaceAll(`b/modified/${rel}`, `b/${rel}`)
}
fs.writeFileSync(path.join(root, '../patches/@michengai__dsh-im-connect@0.1.77.patch'), patch)
