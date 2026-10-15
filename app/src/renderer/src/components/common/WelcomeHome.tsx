import type { Welcome } from '@shared/bridge'
import { useCallback, useEffect, useRef, useState } from 'react'
import { bridge, isMockMode } from '@/env'
import styles from './common.module.css'

/**
 * Checks typed artist names against the sealed welcome (main/welcome.ts). The welcome shows once each time a name
 * opens it: typing on past the name, then back, shows it again; nothing else does.
 */
export function useWelcomeHome(): { welcome: Welcome | null; check(name: string): void; done(): void } {
  const [welcome, setWelcome] = useState<Welcome | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const seq = useRef(0)
  const open = useRef(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const check = useCallback((name: string) => {
    const b = bridge()
    if (!b?.welcome || isMockMode()) return
    window.clearTimeout(timer.current)
    const n = ++seq.current
    timer.current = window.setTimeout(() => {
      void b.welcome(name).then(
        (w) => {
          if (n !== seq.current) return
          if (!w) setWelcome(null)
          else if (!open.current) setWelcome(w)
          open.current = Boolean(w)
        },
        () => {},
      )
    }, 400)
  }, [])
  const done = useCallback(() => setWelcome(null), [])
  return { welcome, check, done }
}

/** The welcome itself: fades in under the artist field, stays a few seconds, fades out. */
export function WelcomeHome({ welcome, onDone }: { welcome: Welcome; onDone(): void }) {
  return (
    <div className={styles.welcomeHome} role="status" onAnimationEnd={(e) => e.target === e.currentTarget && onDone()}>
      <img className={styles.welcomeMark} src={welcome.mark} alt="" />
      <div className={styles.welcomeText}>
        <img className={styles.welcomeWordmark} src={welcome.wordmark} alt="" />
        <p className={styles.welcomeLine}>{welcome.line}</p>
      </div>
    </div>
  )
}
