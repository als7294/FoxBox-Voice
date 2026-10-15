#!/usr/bin/env node
// Mints FoxBox Voice beta invite codes (local only: never shipped, never run in CI).
//   node scripts/mint-beta-codes.mjs <count> --out <file>    new codes → <file> (0600, must not exist yet);
//                                                           their hashes → src/main/beta-codes.json (commit that)
//   node scripts/mint-beta-codes.mjs --revoke FBV-0007      lock a leaked code out from the next update on
// The codes themselves are written to <file> only: never to stdout, a log or the repo. Keep <file> outside the repo
// (e.g. ~/.config/foxbox-voice/), and hand the codes out from there.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeTag, entryFor, formatCode, randomCode } from '../src/main/beta.ts'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bookPath = join(appDir, 'src', 'main', 'beta-codes.json')
const book = JSON.parse(readFileSync(bookPath, 'utf8'))
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const save = () => writeFileSync(bookPath, `${JSON.stringify(book, null, 2)}\n`)

const revoke = flag('--revoke')
if (revoke) {
  if (!book.codes.some((c) => c.id === revoke)) throw new Error(`No code ${revoke} in beta-codes.json.`)
  if (!book.revoked.includes(revoke)) book.revoked.push(revoke)
  save()
  console.log(`Revoked ${revoke}: blocked from the next release on (activations included).`)
  process.exit(0)
}

const count = Number(args[0])
const out = flag('--out') && resolve(flag('--out'))
if (!Number.isInteger(count) || count < 1 || count > 500 || !out) {
  console.error('Usage: node scripts/mint-beta-codes.mjs <count 1-500> --out <file outside the repo>')
  process.exit(1)
}
const repo = resolve(appDir, '..')
if (out === repo || out.startsWith(repo + sep)) throw new Error('Write the codes outside the repository.')
if (existsSync(out)) throw new Error(`${out} exists: pick a new file (codes are never overwritten).`)

const used = new Set(book.codes.map((c) => c.tag))
let next = book.codes.reduce((n, c) => Math.max(n, Number(c.id.slice(4))), 0) + 1
const lines = []
for (let i = 0; i < count; i++) {
  let code = randomCode()
  // A distinct tag per code keeps every check to one scrypt.
  while (used.has(codeTag(code))) code = randomCode()
  const id = `FBV-${String(next++).padStart(4, '0')}`
  const entry = await entryFor(id, code)
  used.add(entry.tag)
  book.codes.push(entry)
  lines.push(`${id}  ${formatCode(code)}`)
}
writeFileSync(out, `${lines.join('\n')}\n`, { mode: 0o600 })
chmodSync(out, 0o600)
save()
console.log(`Minted ${count} codes (${lines[0].split(' ')[0]} … ${lines.at(-1).split(' ')[0]}) into ${out}; hashes added to src/main/beta-codes.json.`)
