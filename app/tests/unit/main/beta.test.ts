import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTIVATION_FILE,
  BetaAccess,
  entryFor,
  formatCode,
  keyCandidates,
  macDigest,
  normalizeCode,
  normalizeWord,
  randomCode,
  type CodeBook,
} from '../../../src/main/beta'

const temp = () => mkdtempSync(join(tmpdir(), 'fbv-beta-'))

describe('invite codes', () => {
  it('reads typed codes forgivingly and refuses anything else', () => {
    expect(normalizeCode('fbv-ab12-cd34-ef56')).toBe('AB12CD34EF56')
    expect(normalizeCode(' FBV ab12 cd34 ef56 ')).toBe('AB12CD34EF56')
    // O is 0, I and L are 1 (Crockford base32 has none of them).
    expect(normalizeCode('FBV-ABO2-CDI4-EFL6')).toBe('AB02CD14EF16')
    expect(normalizeCode('FBV-AB12-CD34-EF5')).toBeNull()
    expect(normalizeCode('FBV-AB12-CD34-EF5U')).toBeNull() // U isn't in the alphabet
    expect(normalizeCode(42)).toBeNull()
    const code = randomCode()
    expect(normalizeCode(formatCode(code))).toBe(code)
  })

  it('unlocks this Mac with a minted code, once, and only this Mac; revocation locks it out', async () => {
    const good = randomCode()
    const book: CodeBook = { revoked: [], codes: [await entryFor('FBV-0001', good)] }
    // The book holds no code, only its salted hash.
    expect(JSON.stringify(book)).not.toContain(good)
    const dir = temp()
    const access = new BetaAccess(dir, book, 'MAC-UUID-1')
    expect(await access.status()).toEqual({ state: 'needed' })

    expect(await access.activate('FBV-0000-0000-0000', 0)).toEqual({ ok: false, error: "That invite code isn't valid." })
    // A failure holds the next try for a second.
    expect((await access.activate(formatCode(good), 500)).ok).toBe(false)
    expect(await access.activate(formatCode(good).toLowerCase(), 2000)).toEqual({ ok: true, id: 'FBV-0001' })
    expect(await access.status()).toEqual({ state: 'active', id: 'FBV-0001' })
    expect(statSync(join(dir, ACTIVATION_FILE)).mode & 0o777).toBe(0o600)
    // The activation keeps the code (0600) so each launch can check it against the book again.
    expect(JSON.parse(readFileSync(join(dir, ACTIVATION_FILE), 'utf8')).code).toBe(good)

    // The same data folder on another Mac isn't unlocked.
    expect(await new BetaAccess(dir, book, 'MAC-UUID-2').status()).toEqual({ state: 'needed' })
    // An update that revokes the code: the activation stops working and the code is refused.
    const revoked = { ...book, revoked: ['FBV-0001'] }
    expect(await new BetaAccess(dir, revoked, 'MAC-UUID-1').status()).toEqual({ state: 'revoked', id: 'FBV-0001' })
    const fresh = new BetaAccess(temp(), revoked, 'MAC-UUID-1')
    expect(await fresh.activate(formatCode(good), 0)).toEqual({ ok: false, error: 'That invite code was withdrawn. Ask for a new one.' })
  })

  it('checks the stored activation on every launch: valid, missing, wrong Mac, revoked, corrupted, re-minted', async () => {
    const good = randomCode()
    const book: CodeBook = { revoked: [], codes: [await entryFor('FBV-0007', good)] }
    const dir = temp()
    const access = (b = book, mac = 'MAC-A') => new BetaAccess(dir, b, mac)
    expect(await access().status()).toEqual({ state: 'needed' }) // missing
    expect((await access().activate(formatCode(good))).ok).toBe(true)
    expect(await access().status()).toEqual({ state: 'active', id: 'FBV-0007' }) // valid
    expect(await access(book, 'MAC-B').status()).toEqual({ state: 'needed' }) // wrong machine
    expect(await access({ ...book, revoked: ['FBV-0007'] }).status()).toEqual({ state: 'revoked', id: 'FBV-0007' }) // revoked
    // The same id minted again (a different hash): the old activation no longer counts.
    const reminted: CodeBook = { revoked: [], codes: [await entryFor('FBV-0007', randomCode())] }
    expect(await access(reminted).status()).toEqual({ state: 'needed' })
    const file = join(dir, ACTIVATION_FILE)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { code: string }
    writeFileSync(file, JSON.stringify({ ...saved, code: randomCode() }))
    expect(await access().status()).toEqual({ state: 'needed' }) // another code
    writeFileSync(file, '{"id": "FBV-0007", "ha') // corrupted
    expect(await access().status()).toEqual({ state: 'needed' })
    writeFileSync(file, 'null')
    expect(await access().status()).toEqual({ state: 'needed' })
  })

  it('reads a word key: upper case, letters and digits only, 4 to 24 of them', () => {
    expect(normalizeWord('  Night Shift 9! ')).toBe('NIGHTSHIFT9')
    expect(normalizeWord('abc')).toBeNull() // under 4
    expect(normalizeWord('a'.repeat(25))).toBeNull() // over 24
    expect(normalizeWord('é-é-é-é')).toBeNull() // nothing left after A-Z 0-9
    expect(normalizeWord(7)).toBeNull()
    // A 12-letter word with no U also reads as a code (O as 0, L as 1): both forms are tried.
    expect(keyCandidates('basslinedrop')).toEqual(['BASS11NEDR0P', 'BASSLINEDROP'])
    expect(keyCandidates('FBV-AB12-CD34-EF56')).toEqual(['AB12CD34EF56', 'FBVAB12CD34EF56'])
  })

  it('unlocks with a word key minted into the book, refuses a wrong one, and a revoked key id locks it out', async () => {
    // A dummy word for the test only: the real key is minted by the user and never seen here.
    const word = 'Dummy Test Word 42'
    const book: CodeBook = { revoked: [], codes: [await entryFor('FBV-0001', randomCode()), await entryFor('W-001', normalizeWord(word)!)] }
    expect(JSON.stringify(book)).not.toContain('DUMMYTESTWORD42')
    const dir = temp()
    const access = new BetaAccess(dir, book, 'MAC-1')
    expect(await access.activate('dummy test word 41', 0)).toEqual({ ok: false, error: "That key isn't valid." })
    expect(await access.activate('ab', 2000)).toEqual({ ok: false, error: 'Type your invite code or key.' })
    // However it's typed: case, spaces and symbols don't matter.
    expect(await access.activate('dummy-test-word-42', 4000)).toEqual({ ok: true, id: 'W-001' })
    expect(await access.status()).toEqual({ state: 'active', id: 'W-001' })
    expect(JSON.parse(readFileSync(join(dir, ACTIVATION_FILE), 'utf8')).code).toBe('DUMMYTESTWORD42')
    // Revoked by id, like a code: the activation stops and the key is refused.
    const revoked = { ...book, revoked: ['W-001'] }
    expect(await new BetaAccess(dir, revoked, 'MAC-1').status()).toEqual({ state: 'revoked', id: 'W-001' })
    expect(await new BetaAccess(temp(), revoked, 'MAC-1').activate(word, 0)).toEqual({ ok: false, error: 'That key was withdrawn. Ask for a new one.' })
  })

  it('a 12-letter word that also reads as a code still unlocks, now and on the next launch', async () => {
    const word = 'basslinedrop'
    const book: CodeBook = { revoked: [], codes: [await entryFor('W-002', normalizeWord(word)!)] }
    const dir = temp()
    expect(await new BetaAccess(dir, book, 'M').activate(word, 0)).toEqual({ ok: true, id: 'W-002' })
    expect(await new BetaAccess(dir, book, 'M').status()).toEqual({ state: 'active', id: 'W-002' })
  })

  it('keeps the code messages for anything typed as a code', async () => {
    const access = new BetaAccess(temp(), { revoked: [], codes: [await entryFor('FBV-0001', randomCode())] }, 'M')
    expect(await access.activate('FBV-0000-0000-0000', 0)).toEqual({ ok: false, error: "That invite code isn't valid." })
    expect(await access.activate('FBV-AB12-CD34-EF5', 2000)).toEqual({ ok: false, error: 'An invite code looks like FBV-XXXX-XXXX-XXXX.' })
  })

  it('refuses a forged activation: everything the app ships, this Mac, but no code', async () => {
    const good = randomCode()
    const entry = await entryFor('FBV-0003', good)
    const dir = temp()
    const forged = { id: entry.id, hash: entry.hash, at: '', mac: macDigest('MAC') }
    writeFileSync(join(dir, ACTIVATION_FILE), JSON.stringify(forged))
    expect(await new BetaAccess(dir, { revoked: [], codes: [entry] }, 'MAC').status()).toEqual({ state: 'needed' })
    writeFileSync(join(dir, ACTIVATION_FILE), JSON.stringify({ ...forged, code: 'NOT-A-CODE' }))
    expect(await new BetaAccess(dir, { revoked: [], codes: [entry] }, 'MAC').status()).toEqual({ state: 'needed' })
  })
})
