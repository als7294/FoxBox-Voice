import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BetaState } from '@shared/bridge'
import launchPosterUrl from '../../../../../design/brand/voice/fbv-launch-poster.jpg?url'
import launchVideoUrl from '../../../../../design/brand/voice/fbv-launch.mp4?url'
import { Button } from '@/components/common/Button'
import { bridge } from '@/env'
import { animate, reducedMotion } from '@/visuals/motion'
import styles from './setup.module.css'

/** FBV-XXXX-XXXX-XXXX as it's typed: upper case, dashes added (the check itself is main's, offline). */
export function formatTyped(raw: string): string {
  let s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (s.startsWith('FBV')) s = s.slice(3)
  s = s.slice(0, 12)
  return s ? `FBV-${s.match(/.{1,4}/g)!.join('-')}` : ''
}

/** ACTIVATE's backdrop: the launch scene (the boot screen's painted loop) under its night scrim; a still frame under
 *  reduced motion. Setup's window renders it behind everything while the step shows. */
export function ActivateScene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <video
        className={styles.sceneVideo}
        src={launchVideoUrl}
        poster={launchPosterUrl}
        autoPlay={!reducedMotion()}
        loop
        muted
        playsInline
        disablePictureInPicture
      />
      <div className={styles.sceneScrim} />
    </div>
  )
}

type CardState = 'idle' | 'checking' | 'bad' | 'accepted'
/** The check takes a moment however fast scrypt is: long enough to read as calm, not a flicker. */
const CHECK_MIN_MS = 650
/** Accepted: the glow, then the card lifts away while the scene clears (main or Setup moves on at 900 ms). */
const LEAVE_AFTER_MS = 350

/**
 * Setup's ACTIVATE step: shown first whenever this Mac has no valid activation (checked on every launch). One line, the
 * code field and UNLOCK, on a light card over the launch scene (the top bar already carries the lockup); main checks the
 * code and says where to go next: the Studio (Setup was done before) or WELCOME.
 */
export function ActivateStep({
  state,
  onSetup,
  onAccepted,
}: {
  state: BetaState | null
  onSetup(): void
  /** Accepted: the scene behind can start to clear. */
  onAccepted?(): void
}) {
  const [code, setCode] = useState('')
  const [card, setCard] = useState<CardState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => input.current?.focus(), [])

  const refuse = (message: string) => {
    setError(message)
    setCard('bad')
    input.current?.select()
    // A small shake, settling fast (the tint stays until the code changes; under reduced motion only the tint).
    animate(form.current, [0, -7, 6, -4, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 420, easing: 'ease-out' })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const b = bridge()
    if (!b || card === 'checking' || accepted) return
    setCard('checking')
    setError(null)
    try {
      // The calm pause comes first: once main answers 'app' it opens the Studio 900 ms later, and the success needs
      // all of that to show.
      await new Promise((done) => setTimeout(done, CHECK_MIN_MS))
      const r = await b.beta.activate(code)
      if (r.ok) {
        setAccepted(r.id)
        setCard('accepted')
        onAccepted?.()
        window.setTimeout(() => setLeaving(true), LEAVE_AFTER_MS)
        if (r.next !== 'app') window.setTimeout(onSetup, 900) // 'app': main opens the Studio and closes Setup
      } else refuse(r.error)
    } catch (err) {
      refuse((err as Error).message)
    }
  }

  return (
    <form
      ref={form}
      className={styles.activate}
      data-state={card}
      data-leaving={leaving || undefined}
      onSubmit={(e) => void submit(e)}
      data-testid="beta-access"
      aria-busy={card === 'checking'}
    >
      <h1 className={styles.activateLine}>{state?.state === 'revoked' ? 'Enter a new invite code.' : 'Enter your invite code.'}</h1>
      <input
        ref={input}
        id="invite"
        className={styles.codeInput}
        value={code}
        onChange={(e) => {
          setCode(formatTyped(e.target.value))
          setError(null)
          if (card === 'bad') setCard('idle')
        }}
        placeholder="FBV-XXXX-XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={18}
        disabled={Boolean(accepted)}
        aria-label="Invite code"
        aria-invalid={Boolean(error)}
        aria-describedby="invite-status"
      />
      <p id="invite-status" className={styles.codeStatus} data-tone={accepted ? 'ok' : error ? 'bad' : undefined} role="status">
        {accepted
          ? `Accepted · ${accepted}`
          : card === 'checking'
            ? 'Checking on this Mac…'
            : (error ?? (state?.state === 'revoked' ? `The invite this Mac used (${state.id}) was withdrawn.` : ' '))}
      </p>
      <div>
        <Button type="submit" variant="primary" size="lg" disabled={card === 'checking' || Boolean(accepted) || code.length < 18}>
          {card === 'checking' ? 'Checking…' : accepted ? 'Unlocked' : 'Unlock'}
        </Button>
      </div>
    </form>
  )
}
