/**
 * A sealed welcome for one artist name. The app ships only salt, nonce, ciphertext and tag (welcome.json, written
 * by scripts/seal-welcome.mjs, which the user runs); the name itself is the key (scrypt), so it is in no file.
 * Typing it in Setup's artist field, or as the artist tag in Settings, opens the welcome: a line and two images.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'node:crypto'
import type { Welcome } from '../shared/bridge'

export interface Sealed {
  salt: string
  nonce: string
  ct: string
  tag: string
}
/** What is sealed: the images as PNG base64. */
export interface WelcomePayload {
  line: string
  mark: string
  wordmark: string
}

/** How the name is compared: trimmed, spaces collapsed, case ignored. */
export const normalizeArtist = (name: string): string => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const b64 = (b: Buffer) => b.toString('base64')

export function seal(name: string, payload: WelcomePayload): Sealed {
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const key = scryptSync(normalizeArtist(name), salt, 32, KDF)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return { salt: b64(salt), nonce: b64(nonce), ct: b64(ct), tag: b64(cipher.getAuthTag()) }
}

/** The welcome, or null: no blob, another name, or a damaged blob. */
export async function openWelcome(name: string, sealed: Sealed | null): Promise<Welcome | null> {
  const n = normalizeArtist(name)
  if (!sealed || !n) return null
  const key = await new Promise<Buffer>((done, fail) =>
    scrypt(n, Buffer.from(sealed.salt, 'base64'), 32, KDF, (err, k) => (err ? fail(err) : done(k))),
  )
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64'))
    d.setAuthTag(Buffer.from(sealed.tag, 'base64'))
    const p = JSON.parse(Buffer.concat([d.update(Buffer.from(sealed.ct, 'base64')), d.final()]).toString('utf8')) as WelcomePayload
    return { line: p.line, mark: `data:image/png;base64,${p.mark}`, wordmark: `data:image/png;base64,${p.wordmark}` }
  } catch {
    return null // another name: the tag doesn't verify
  }
}
