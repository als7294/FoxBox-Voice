#!/usr/bin/env node
// Mints FoxBox Voice beta invite codes (local only: never shipped, never run in CI).
//   node scripts/mint-beta-codes.mjs <count> --out <file>    new codes → <file> (0600, must not exist yet);
//                                                           their hashes → src/main/beta-codes.json (commit that)
//   node scripts/mint-beta-codes.mjs --revoke FBV-0007      lock a leaked code out from the next update on
//   node scripts/mint-beta-codes.mjs --word W-001           a word key: asked for twice, hidden, in the terminal;
//                                                           only its hash goes to src/main/beta-codes.json (commit that)
// The codes themselves are written to <file> only: never to stdout, a log or the repo. Keep <file> outside the repo
// (e.g. ~/.config/foxbox-voice/), and hand the codes out from there. A word key is never written anywhere: it isn't
// an argument (so not in the shell history), isn't echoed and isn't printed.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORD_MAX, WORD_MIN, codeTag, entryFor, formatCode, normalizeWord, randomCode } from '../src/main/beta.ts'

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

/** A line typed in the terminal with nothing echoed (raw mode before the prompt shows, as in seal-welcome.mjs). */
function askHidden(question) {
  return new Promise((done) => {
    const input = process.stdin
    input.setRawMode(true)
    process.stdout.write(question)
    input.resume()
    input.setEncoding('utf8')
    let s = ''
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          input.setRawMode(false)
          input.pause()
          input.off('data', onData)
          process.stdout.write('\n')
          return done(s)
        }
        if (c === '\u0003') process.exit(130)
        s = c === '\u007f' ? s.slice(0, -1) : s + c
      }
    }
    input.on('data', onData)
  })
}

const wordId = flag('--word')
if (args.includes('--word')) {
  if (!/^W-\d{3}$/.test(wordId ?? '')) throw new Error('Usage: node scripts/mint-beta-codes.mjs --word W-001 (ids W-001…W-999)')
  if (book.codes.some((c) => c.id === wordId)) throw new Error(`${wordId} is already in beta-codes.json: pick the next id.`)
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal: the key is typed at a hidden prompt, never passed in.')
  const word = normalizeWord(await askHidden(`Key for ${wordId} (hidden): `))
  if (!word) throw new Error(`A key is ${WORD_MIN}-${WORD_MAX} letters or digits (spaces and symbols are dropped); nothing written.`)
  // The ACTIVATE field formats anything starting with FBV as an invite code.
  if (word.startsWith('FBV')) throw new Error('A key can\'t start with "FBV" (that reads as an invite code); nothing written.')
  if (normalizeWord(await askHidden('Once more: ')) !== word) throw new Error("The two didn't match; nothing written.")
  book.codes.push(await entryFor(wordId, word))
  save()
  console.log(`Added ${wordId}'s hash to src/main/beta-codes.json (the key itself isn't stored). Commit that file, then build.`)
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
let next = book.codes.filter((c) => c.id.startsWith('FBV-')).reduce((n, c) => Math.max(n, Number(c.id.slice(4))), 0) + 1
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
