import { describe, expect, it } from 'vitest'
import { openWelcome, seal } from '../../../src/main/welcome'
import shipped from '../../../src/main/welcome.json'

const payload = { line: 'Welcome home.', mark: 'TUFSSw==', wordmark: 'V09SRA==' }

describe('the sealed welcome', () => {
  it('opens for the name, trimmed and in any case, and for nothing else', async () => {
    const sealed = seal('Test Artist', payload)
    expect(JSON.stringify(sealed)).not.toMatch(/test artist|Welcome home/i)
    expect(await openWelcome('  test   ARTIST ', sealed)).toEqual({
      line: 'Welcome home.',
      mark: 'data:image/png;base64,TUFSSw==',
      wordmark: 'data:image/png;base64,V09SRA==',
    })
    expect(await openWelcome('Test Artiste', sealed)).toBeNull()
    expect(await openWelcome('', sealed)).toBeNull()
    expect(await openWelcome('Test Artist', { ...sealed, tag: Buffer.alloc(16).toString('base64') })).toBeNull()
  })

  it('ships either nothing or only salt, nonce, ciphertext and tag', () => {
    expect(shipped === null || Object.keys(shipped as object).sort().join() === 'ct,nonce,salt,tag').toBe(true)
  })
})
