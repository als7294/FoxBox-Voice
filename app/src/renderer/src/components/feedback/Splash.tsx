import type { EngineStatus } from '@shared/bridge'
import { useEffect, useRef, useState } from 'react'
import launchPosterUrl from '../../../../../design/brand/voice/fbv-launch-poster.jpg?url'
import launchVideoUrl from '../../../../../design/brand/voice/fbv-launch.mp4?url'
import { api, unwrap } from '@/api/client'
import { FoxMark } from '@/components/common/FoxMark'
import { Lockup } from '@/components/common/Lockup'
import { useBootUpdate } from '@/components/updates/useBootUpdate'
import { bridge } from '@/env'
import { connectEngineStatus, engineHealth, useEngine } from '@/state/engine'
import { launchState, type Download } from '@/state/launch'
import { reducedMotion } from '@/visuals/motion'
import styles from './splash.module.css'

/** Tips, with the script markup shown as real tokens (the site's colours: | teal, *word* violet, [2b] a mono chip). */
type Seg = string | { tok: string; kind: 'beat' | 'echo' | 'gap' }
const TIPS: Seg[][] = [
  [{ tok: '|', kind: 'beat' }, ' starts the next part on the next beat.'],
  [{ tok: '*word*', kind: 'echo' }, ' throws that word into an echo.'],
  [{ tok: '[2b]', kind: 'gap' }, ' is a gap of two beats.'],
  ['Drag the finished vocal straight into your DAW.'],
]
const TIP_MS = 3500
/** No milestone for this long is a failed start. */
const STALL_MS = 60_000

/** A required voice model downloading at launch (a deleted model): its bytes from /api/models, time left from its pace. */
function useModelDownload(status: EngineStatus): Download | null {
  const h = engineHealth(status)
  const downloading = h?.state === 'loading_model' && /download/i.test(h.message ?? '') && h.progress != null
  const [total, setTotal] = useState<number | null>(null)
  const start = useRef<{ t: number; p: number } | null>(null)
  const missing = (h?.required_missing ?? []).join()
  useEffect(() => {
    if (!downloading || !missing) return
    void unwrap(api.GET('/api/models')).then(
      (models) => setTotal(models.filter((m) => missing.split(',').includes(m.id)).reduce((s, m) => s + m.size_bytes, 0) || null),
      () => {},
    )
  }, [downloading, missing])
  if (!downloading) {
    start.current = null
    return null
  }
  const p = h.progress ?? 0
  const now = Date.now()
  start.current ??= { t: now, p }
  const pace = (p - start.current.p) / Math.max(0.001, (now - start.current.t) / 1000)
  return { done: total != null ? total * p : null, total, etaS: pace > 0 ? (1 - p) / pace : null }
}

/**
 * The launch splash (`index.html?window=splash`, 720×450, frameless): the painted studio scene, and one status line
 * with a thin bar on the real milestones (the invite check, the update check, the engine starting, the voices loading,
 * the GPU warming up), download sizes and time left, a rotating tip, and a plain failure with Retry / Quit. When the
 * engine is ready and nothing holds the boot it fades and tells main, which shows the Studio.
 */
export function SplashWindow() {
  useEffect(() => connectEngineStatus(), [])
  const status = useEngine((s) => s.status)
  const update = useBootUpdate()
  const model = useModelDownload(status)
  const [stalled, setStalled] = useState(false)
  const [tip, setTip] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const launch = launchState(status, update.state, stalled, model)
  const moved = useRef({ key: '', at: Date.now() })
  const done = useRef(launch.done)
  done.current = launch.done

  useEffect(() => {
    const key = `${launch.line}|${launch.pct}|${launch.detail ?? ''}`
    if (key === moved.current.key) return
    moved.current = { key, at: Date.now() }
    setStalled(false)
  }, [launch.line, launch.pct, launch.detail])
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!done.current && Date.now() - moved.current.at > STALL_MS) setStalled(true)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % TIPS.length), TIP_MS)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    if (!launch.done || leaving) return
    setLeaving(true)
    bridge()?.splash?.done()
  }, [launch.done, leaving])

  const act = () => {
    if (launch.failure?.action === 'continue') return update.proceed()
    moved.current = { key: '', at: Date.now() }
    setStalled(false)
    void bridge()?.restartEngine()
  }

  return (
    <div className={styles.splash} data-leaving={leaving || undefined} data-testid="splash">
      <video
        className={styles.video}
        src={launchVideoUrl}
        poster={launchPosterUrl}
        autoPlay={!reducedMotion()}
        loop
        muted
        playsInline
        disablePictureInPicture
        aria-hidden="true"
      />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.column}>
        <Lockup className={styles.lockup} />
        {launch.failure ? (
          <div className={styles.failure} role="alert">
            <p className={styles.failStep}>{launch.failure.step} didn't finish.</p>
            <p className={styles.failWhy}>{launch.failure.why}</p>
            <div className={styles.buttons}>
              <button type="button" className={styles.primary} onClick={act}>
                {launch.failure.action === 'continue' ? 'Continue' : 'Retry'}
              </button>
              <button type="button" className={styles.secondary} onClick={() => bridge()?.splash?.quit()}>
                Quit
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.status} role="status" aria-live="polite">
            <p key={launch.line} className={styles.line} data-active={!launch.done || undefined}>
              {launch.line}
            </p>
            <div className={styles.track} aria-hidden="true">
              <div className={styles.bar} style={{ transform: `scaleX(${launch.pct / 100})` }} />
            </div>
            <p className={styles.detail}>{launch.detail ?? ' '}</p>
          </div>
        )}
        <div className={styles.tipPill}>
          <span className={styles.tipHead}>
            <FoxMark size={14} />
            TIP
          </span>
          <span key={tip} className={styles.tip}>
            {TIPS[tip]!.map((s, i) =>
              typeof s === 'string' ? (
                s
              ) : (
                <span key={i} className={styles.tok} data-kind={s.kind}>
                  {s.tok}
                </span>
              ),
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
