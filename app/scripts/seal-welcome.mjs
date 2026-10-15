#!/usr/bin/env node
// Seals the artist welcome into src/main/welcome.json (local; the user runs it, and nothing is printed but a size).
//   node scripts/seal-welcome.mjs <folder with the two logo PNGs> [--line "Welcome home."]
//   node scripts/seal-welcome.mjs <mark.png> <wordmark.png> [--line "Welcome home."]
// The artist name is asked for twice, hidden. In a folder, the square PNG is the mark and the widest one the wordmark.
// Both are shrunk (mark 512 px, wordmark 1200 px wide) with macOS sips, then sealed with AES-256-GCM under
// scrypt(name): welcome.json holds only salt, nonce, ciphertext and tag. Commit that file.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeArtist, seal } from '../src/main/welcome.ts'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'welcome.json')
const args = process.argv.slice(2)
const li = args.indexOf('--line')
const line = li >= 0 ? args.splice(li, 2)[1] : 'Welcome home.'
const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

const size = (file) => {
  const o = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' })
  return [Number(/pixelWidth: (\d+)/.exec(o)?.[1]), Number(/pixelHeight: (\d+)/.exec(o)?.[1])]
}

let [mark, wordmark] = args.map((a) => resolve(a))
if (args.length === 1 && statSync(mark).isDirectory()) {
  const sized = readdirSync(mark)
    .filter((f) => /\.png$/i.test(f))
    .map((f) => ({ f: join(mark, f), wh: size(join(mark, f)) }))
  const squares = sized.filter(({ wh: [w, h] }) => w === h)
  const wide = sized.filter(({ wh: [w, h] }) => w > h * 1.2).sort((a, b) => b.wh[0] - a.wh[0])
  if (squares.length !== 1 || wide.length < 1) fail('Could not tell the mark from the wordmark: pass the two PNGs instead.')
  ;[mark, wordmark] = [squares[0].f, wide[0].f]
} else if (args.length !== 2) {
  fail('Usage: node scripts/seal-welcome.mjs <folder> | <mark.png> <wordmark.png> [--line "Welcome home."]')
}

function askHidden(question) {
  return new Promise((done) => {
    const input = process.stdin
    input.setRawMode(true) // before the prompt shows, so nothing typed is echoed
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

if (!process.stdin.isTTY) fail('Run this in a terminal: it asks for the name.')
const name = await askHidden('Artist name (hidden): ')
if (!normalizeArtist(name)) fail('No name given; nothing written.')
if (normalizeArtist(await askHidden('Once more: ')) !== normalizeArtist(name)) fail("The two didn't match; nothing written.")

const tmp = mkdtempSync(join(tmpdir(), 'fbv-welcome-'))
try {
  const shrink = (src, px, as) => {
    const dst = join(tmp, as)
    execFileSync('sips', ['-s', 'format', 'png', '-Z', String(px), src, '--out', dst], { stdio: 'ignore' })
    return readFileSync(dst).toString('base64')
  }
  const sealed = seal(name, { line, mark: shrink(mark, 512, 'mark.png'), wordmark: shrink(wordmark, 1200, 'wordmark.png') })
  writeFileSync(out, `${JSON.stringify(sealed)}\n`)
  console.log(`Sealed: src/main/welcome.json (${Math.round(statSync(out).size / 1024)} KB). Commit that file.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
