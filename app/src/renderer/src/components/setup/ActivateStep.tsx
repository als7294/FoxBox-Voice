import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BetaState } from '@shared/bridge'
import { Button } from '@/components/common/Button'
import { Lockup } from '@/components/common/Lockup'
import { bridge } from '@/env'
import styles from './setup.module.css'

/** FBV-XXXX-XXXX-XXXX as it's typed: upper case, dashes added (the check itself is main's, offline). */
export function formatTyped(raw: string): string {
  let s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (s.startsWith('FBV')) s = s.slice(3)
  s = s.slice(0, 12)
  return s ? `FBV-${s.match(/.{1,4}/g)!.join('-')}` : ''
}

/**
 * Setup's ACTIVATE step: shown first whenever this Mac has no valid activation (checked on every launch). One field,
 * the invite code; main checks it and says where to go next: the Studio (Setup was done before) or WELCOME.
 */
export function ActivateStep({ state, onSetup }: { state: BetaState | null; onSetup(): void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const b = bridge()
    if (!b || busy || accepted) return
    setBusy(true)
    setError(null)
    try {
      const r = await b.beta.activate(code)
      if (r.ok) {
        setAccepted(r.id)
        if (r.next !== 'app') window.setTimeout(onSetup, 900) // 'app': main opens the Studio and closes Setup
      } else {
        setError(r.error)
        input.current?.select()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.activate} onSubmit={(e) => void submit(e)} data-testid="beta-access">
      <div>
        <div className={styles.kicker}>Beta access</div>
        <h1 className={styles.welcomeTitle}>
          <Lockup className={styles.welcomeLockup} />
        </h1>
      </div>
      <p className={styles.lede}>
        {state?.state === 'revoked'
          ? `The invite this Mac used (${state.id}) was withdrawn. Enter a new one to keep going.`
          : 'FoxBox Voice is in a private beta. Enter your invite code to unlock it on this Mac.'}
      </p>
      <label className={styles.codeLabel} htmlFor="invite">
        Invite code
      </label>
      <input
        ref={input}
        id="invite"
        className={styles.codeInput}
        value={code}
        onChange={(e) => {
          setCode(formatTyped(e.target.value))
          setError(null)
        }}
        placeholder="FBV-XXXX-XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={18}
        disabled={Boolean(accepted)}
        aria-invalid={Boolean(error)}
        aria-describedby="invite-status"
      />
      <p id="invite-status" className={styles.codeStatus} data-tone={accepted ? 'ok' : error ? 'bad' : undefined} role="status">
        {accepted ? `Accepted · ${accepted}` : (error ?? ' ')}
      </p>
      <div>
        <Button type="submit" variant="primary" size="lg" disabled={busy || Boolean(accepted) || code.length < 18}>
          {busy ? 'Checking…' : 'Unlock'}
        </Button>
      </div>
      <p className={styles.note}>Mac (Apple silicon) only · a code is for one Mac · checked on this Mac, nothing is sent</p>
    </form>
  )
}
