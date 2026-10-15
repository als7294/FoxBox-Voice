/**
 * BETA ACCESS: one-time invite codes, checked offline.
 *
 * A code is FBV-XXXX-XXXX-XXXX: 12 characters of Crockford base32 (no I, L, O or U, so nothing looks alike), 60
 * random bits. The app ships no code, only each code's slow hash (scrypt, its own salt) in beta-codes.json, with a
 * 16-bit tag (from a fast hash) that picks the entry so a guess costs one scrypt, not one per code. An accepted code is
 * kept as this Mac's activation (userData/beta-activation.json, 0600, bound to the Mac's hardware UUID, so a copied data
 * folder doesn't carry it), and every launch checks that code against the book again: an activation file can't be
 * written from what the app ships without a real code.
 *
 * Honest limits: there is no server, so nothing stops one code from unlocking several Macs. `revoked` (code ids) in
 * beta-codes.json is the only lever: an update that lists a leaked code locks it out, activations included.
 *
 * Plain erasable TypeScript with node builtins only: scripts/mint-beta-codes.mjs imports this file directly.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BetaActivateResult as ActivateResult, BetaState } from '../shared/bridge'

/** Crockford base32. Typing is forgiving: O reads as 0, I and L as 1, and case, spaces and dashes don't matter. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_LENGTH = 12
/** 32 MiB per check, ~0.1 s on an M1: cheap for one person typing, slow for anyone guessing. */
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 } as const
export const ACTIVATION_FILE = 'beta-activation.json'

export interface CodeEntry {
  /** Public id, FBV-0001…: what the revocation list and the activation name. */
  id: string
  /** First 4 hex of sha256('fbv-tag|' + code): picks the candidate entries. */
  tag: string
  salt: string
  /** scrypt(code, salt), base64. */
  hash: string
}

export interface CodeBook {
  revoked: string[]
  codes: CodeEntry[]
}

export interface Activation {
  id: string
  /** The code itself (12 characters), checked against the book on every launch. */
  code: string
  at: string
  /** sha256 of this Mac's hardware UUID. */
  mac: string
}

/** The 12 code characters from whatever was typed or pasted, or null when it can't be a code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null
  let s = raw.toUpperCase().replace(/[\s\-–—_.]/g, '')
  if (s.startsWith('FBV')) s = s.slice(3)
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== CODE_LENGTH) return null
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null
  return s
}

export const formatCode = (code: string): string => `FBV-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`

export const codeTag = (code: string): string => createHash('sha256').update(`fbv-tag|${code}`).digest('hex').slice(0, 4)

export function hashCode(code: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) =>
    scrypt(code, Buffer.from(salt, 'base64'), 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key.toString('base64')))),
  )
}

/** A new random code (60 bits; rejection-free since 32 divides 256). */
export function randomCode(): string {
  return [...randomBytes(CODE_LENGTH)].map((b) => CODE_ALPHABET[b % 32]).join('')
}

/** Mints one entry for `code` (the code itself is never stored). */
export async function entryFor(id: string, code: string): Promise<CodeEntry> {
  const salt = randomBytes(16).toString('base64')
  return { id, tag: codeTag(code), salt, hash: await hashCode(code, salt) }
}

/** The entry this code belongs to, or null. */
export async function findCode(book: CodeBook, code: string): Promise<CodeEntry | null> {
  const tag = codeTag(code)
  for (const e of book.codes) {
    if (e.tag !== tag) continue
    const got = Buffer.from(await hashCode(code, e.salt), 'base64')
    const want = Buffer.from(e.hash, 'base64')
    if (got.length === want.length && timingSafeEqual(got, want)) return e
  }
  return null
}

export const macDigest = (uuid: string): string => createHash('sha256').update(`fbv-mac|${uuid}`).digest('hex')

/** This Mac's hardware UUID (IOPlatformUUID), or '' when ioreg can't say. */
export function hardwareUuid(): Promise<string> {
  return new Promise((resolve) =>
    execFile('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 5000 }, (err, out) =>
      resolve(err ? '' : (/"IOPlatformUUID" = "([^"]+)"/.exec(out)?.[1] ?? '')),
    ),
  )
}

/** The access check for one app install: its activation file, the shipped code book, this Mac. */
export class BetaAccess {
  private readonly file: string
  private readonly book: CodeBook
  private readonly mac: string
  private busyUntil = 0

  constructor(userData: string, book: CodeBook, machineUuid: string) {
    this.file = join(userData, ACTIVATION_FILE)
    this.book = book
    this.mac = macDigest(machineUuid)
  }

  /**
   * Checked on every launch, offline (one scrypt, ~0.1 s): the activation file parses, was made on this Mac, and holds
   * a code that is in the shipped book and not revoked. Anything else asks for a code again.
   */
  async status(): Promise<BetaState> {
    let a: Partial<Activation> | null = null
    try {
      a = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Activation>) : null
    } catch {
      a = null // corrupted: as if missing
    }
    if (!a || typeof a !== 'object' || a.mac !== this.mac) return { state: 'needed' }
    const code = normalizeCode(a.code)
    const entry = code ? await findCode(this.book, code) : null
    if (!entry) return { state: 'needed' }
    return this.book.revoked.includes(entry.id) ? { state: 'revoked', id: entry.id } : { state: 'active', id: entry.id }
  }

  /** Checks a typed code; on success stores this Mac's activation. A failure holds the next try for a second. */
  async activate(raw: unknown, now = Date.now()): Promise<ActivateResult> {
    if (now < this.busyUntil) return { ok: false, error: 'One moment, then try again.' }
    const code = normalizeCode(raw)
    const entry = code ? await findCode(this.book, code) : null
    if (!entry) {
      this.busyUntil = now + 1000
      return { ok: false, error: code ? "That invite code isn't valid." : 'An invite code looks like FBV-XXXX-XXXX-XXXX.' }
    }
    if (this.book.revoked.includes(entry.id)) {
      this.busyUntil = now + 1000
      return { ok: false, error: 'That invite code was withdrawn. Ask for a new one.' }
    }
    mkdirSync(join(this.file, '..'), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    const activation: Activation = { id: entry.id, code: code!, at: new Date(now).toISOString(), mac: this.mac }
    writeFileSync(tmp, `${JSON.stringify(activation, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, this.file)
    return { ok: true, id: entry.id }
  }
}
