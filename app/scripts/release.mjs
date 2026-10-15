#!/usr/bin/env node
// Builds a FoxBox Voice release. It never publishes anything: attach the files it prints to a GitHub release on
// als7294/FoxBox-Voice yourself (after the user approves it).
//   node scripts/release.mjs <beta|patch|minor|major|x.y.z[-beta.n]|--no-bump> [--notes "line"]... [--notes-file <file>]
//   e.g. node scripts/release.mjs beta   (1.0.0-beta.1 → 1.0.0-beta.2; release-notes/<version>.md is used
//   automatically when no notes are given)
// The beta is a normal (not pre-release) GitHub release named "… (beta)": GitHub's releases/latest, which the app's
// update feed address points at, skips pre-releases, so marking it one would hide every update.
//
// 1. Sets the version in package.json and package-lock.json (commit that yourself).
// 2. Builds the renderer/main (electron-vite) and the bundled-engine app: release/<version>/FoxBox-Voice-<version>-arm64.dmg
//    for first installs and FoxBox-Voice-<version>-arm64.zip for in-app updates.
// 3. Zips each part of the app (src/main/components.ts: app, electron, engine-runtime, engine-code) whose hash is new:
//    FoxBox-Voice-<part>-<hash16>.zip. A part the previous release's feed already lists with the same hash keeps that
//    feed's address (an older release's asset), so it's never uploaded twice. --prev-feed <url|file> (default: the
//    latest GitHub release's feed); --asset-base <url> (default: this version's GitHub release download address).
// 4. Writes release/<version>/latest-mac.json, the update feed the app reads from the latest GitHub release:
//    { version, released, notes[], files: [{ name, kind: 'zip' | 'dmg', size, sha256 }],
//      components: [{ name, hash, url, size, sha256 }] }   (apps before 1.2 read only `files`: the full zip)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const all = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []))
const one = (name) => all(name)[0]

const pkgPath = join(appDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const bumpArg = args[0] && !args[0].startsWith('--') ? args[0] : null
if (!bumpArg && !args.includes('--no-bump')) {
  console.error('usage: node scripts/release.mjs <beta|patch|minor|major|x.y.z[-beta.n]|--no-bump> [--notes "line"]... [--notes-file <file>]')
  process.exit(1)
}

function bump(v, how) {
  if (/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(how)) return how
  const [core, pre] = v.split('-')
  const [maj, min, pat] = core.split('.').map(Number)
  // beta: the next beta of this version (1.0.0-beta.1 → 1.0.0-beta.2; 1.0.0 → 1.0.1-beta.1)
  if (how === 'beta') return pre?.startsWith('beta.') ? `${core}-beta.${Number(pre.slice(5)) + 1}` : `${maj}.${min}.${pat + 1}-beta.1`
  // From a beta, patch/minor/major release that version (1.0.0-beta.3 → patch → 1.0.0).
  if (how === 'major') return pre && min === 0 && pat === 0 ? core : `${maj + 1}.0.0`
  if (how === 'minor') return pre && pat === 0 ? core : `${maj}.${min + 1}.0`
  if (how === 'patch') return pre ? core : `${maj}.${min}.${pat + 1}`
  throw new Error(`Unknown bump "${how}" (beta, patch, minor, major or x.y.z[-beta.n])`)
}

const version = bumpArg ? bump(pkg.version, bumpArg) : pkg.version
if (version !== pkg.version) {
  // Edit the version fields in place so the files keep their formatting.
  const setVersion = (file, count) => {
    const path = join(appDir, file)
    let text = readFileSync(path, 'utf8')
    let n = 0
    text = text.replace(/("version":\s*")[^"]+(")/g, (m, a, b) => (n++ < count ? `${a}${version}${b}` : m))
    writeFileSync(path, text)
  }
  setVersion('package.json', 1)
  setVersion('package-lock.json', 2) // the lockfile's own version and packages[""].version
  console.log(`Version ${pkg.version} → ${version}`)
}

const notes = [...all('--notes')]
const defaultNotes = join(appDir, 'release-notes', `${version}.md`)
const notesFile = one('--notes-file') ?? (notes.length === 0 && existsSync(defaultNotes) ? defaultNotes : undefined)
if (notesFile) notes.push(...readFileSync(resolve(notesFile), 'utf8').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean))

if (!existsSync(join(appDir, 'credit.local.json')) && !process.env.FVWKS_CREDIT_EMAIL) {
  console.warn('Note: no credit.local.json or FVWKS_CREDIT_EMAIL, so the credit ships as plain text (no mail link).')
}

const outDir = join(appDir, 'release', version)
// Release file names: no spaces (GitHub renames assets with spaces). The .app inside keeps its real name.
const artifact = pkg.productName.replace(/ /g, '-')
execFileSync('npx', ['electron-vite', 'build'], { cwd: appDir, stdio: 'inherit' })
execFileSync(process.execPath, [join(appDir, 'scripts', 'package.mjs'), '--bundle-engine', '--dmg', '--out', outDir], { cwd: appDir, stdio: 'inherit' })

const sha256 = (file) =>
  new Promise((ok, fail) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (c) => h.update(c)).on('error', fail).on('end', () => ok(h.digest('hex')))
  })

const files = []
for (const kind of ['zip', 'dmg']) {
  const name = `${artifact}-${version}-arm64.${kind}`
  const path = join(outDir, name)
  if (!existsSync(path)) throw new Error(`Missing ${path}`)
  files.push({ name, kind, size: statSync(path).size, sha256: await sha256(path) })
}
const updates = readFileSync(join(appDir, 'src', 'shared', 'updates.ts'), 'utf8')
const repo = /DEFAULT_UPDATE_REPO\s*=\s*'([^']+)'/.exec(updates)?.[1] ?? '<owner>/<repo>'

// The app's parts: reuse the previous release's zip for an unchanged part, zip the rest.
const { COMPONENTS, readComponentsFile, removeParts } = await import('../src/main/components.ts')
const appPath = join(outDir, 'mac-arm64', `${pkg.productName}.app`)
const hashes = readComponentsFile(appPath)
if (!hashes) throw new Error(`${appPath} has no Contents/Resources/components.json (electron-builder afterPack)`)
const prevSource = one('--prev-feed') ?? `https://github.com/${repo}/releases/latest/download/latest-mac.json`
let prev = null
try {
  const text = /^https?:/.test(prevSource) ? await (await fetch(prevSource)).text() : readFileSync(prevSource, 'utf8')
  prev = JSON.parse(text)
} catch (err) {
  console.warn(`No previous feed at ${prevSource} (${err.message}): every part is zipped.`)
}
const assetBase = one('--asset-base') ?? `https://github.com/${repo}/releases/download/v${version}/`
const components = []
const newParts = []
for (const name of COMPONENTS) {
  const hash = hashes[name]
  const same = Array.isArray(prev?.components) ? prev.components.find((c) => c.name === name && c.hash === hash && c.url) : null
  if (same) {
    components.push({ name, hash, url: same.url, size: same.size, sha256: same.sha256 })
    continue
  }
  const file = `${artifact}-${name}-${hash.slice(0, 16)}.zip`
  const stage = join(outDir, '.parts', `${pkg.productName}.app`)
  rmSync(join(outDir, '.parts'), { recursive: true, force: true })
  mkdirSync(join(outDir, '.parts'), { recursive: true })
  execFileSync('/bin/cp', ['-c', '-R', '-p', appPath, stage])
  removeParts(stage, (c) => c === name)
  const zip = join(outDir, file)
  rmSync(zip, { force: true })
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', stage, zip])
  rmSync(join(outDir, '.parts'), { recursive: true, force: true })
  const size = statSync(zip).size
  components.push({ name, hash, url: new URL(file, assetBase).toString(), size, sha256: await sha256(zip) })
  newParts.push(file)
}

const feed = { version, released: new Date().toISOString().slice(0, 10), notes, files, components }
const feedPath = join(outDir, 'latest-mac.json')
writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`)

console.log(`\nRelease ${version} is ready in ${outDir}:`)
for (const f of files) console.log(`  ${f.name}  ${(f.size / 1e6).toFixed(1)} MB  sha256 ${f.sha256}`)
for (const c of components) console.log(`  part ${c.name.padEnd(14)} ${(c.size / 1e6).toFixed(1).padStart(7)} MB  ${newParts.some((n) => c.url.endsWith(n)) ? 'new' : `unchanged, from ${c.url}`}`)
console.log(`  latest-mac.json`)
console.log(`\nPublish it (not done here; the user approves first), e.g.:`)
console.log(`  gh release create v${version} --repo ${repo} --title "${pkg.productName} ${version} (beta)" --latest \\`)
console.log(`    ${[...files.map((f) => f.name), ...newParts].map((n) => JSON.stringify(join(outDir, n))).join(' ')} ${JSON.stringify(feedPath)}`)
