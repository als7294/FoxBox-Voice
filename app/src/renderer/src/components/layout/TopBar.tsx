import { useRef } from 'react'
import easterMarkUrl from '../../../../../design/brand/voice/fbv-mark-easter.svg?url'
import { useSettings, useUpdateSettings } from '@/api/queries'
import { Lockup } from '@/components/common/Lockup'
import type { Settings } from '@/api/types'
import { bridge } from '@/env'
import { isEngineUsable, useEngine } from '@/state/engine'
import { renderFinal, scheduleRender } from '@/state/renderController'
import { studio, useStudio } from '@/state/studio'
import { toast } from '@/state/toasts'
import { useUi } from '@/state/ui'
import { useFrame } from '@/visuals/frame'
import { vis } from '@/visuals/state'
import { BarsPicker } from './BarsPicker'
import { EngineStatus } from './EngineStatus'
import { KeyPicker } from './KeyPicker'
import { TempoField } from './TempoField'
import styles from './layout.module.css'

type Format = { format: Settings['format']; bit: 16 | 24; rate: 44100 | 48000 }

/** The chip cycles format × sample rate at the current bit depth (16-bit is chosen in SETTINGS). */
function cycleOf(bit: 16 | 24): Format[] {
  return [
    { format: 'aiff', bit, rate: 44100 },
    { format: 'wav', bit, rate: 44100 },
    { format: 'aiff', bit, rate: 48000 },
    { format: 'wav', bit, rate: 48000 },
  ]
}

function currentFormat(s: Settings | undefined): Format {
  return {
    format: s?.format ?? 'aiff',
    bit: (s?.bit_depth ?? 24) as 16 | 24,
    rate: (s?.master?.sample_rate ?? 44100) === 48000 ? 48000 : 44100,
  }
}

const formatLabel = (f: Format) => `${f.format.toUpperCase()} ${f.bit}/${f.rate === 48000 ? '48' : '44.1'}`

/**
 * The FoxBox Voice mark in snow white, pulsing with the beat. It's the easter-egg mark (design/brand/voice/fbv-mark-easter.svg):
 * still almost all the time, then every 17 s the fox glances left and right and flicks an ear (still under
 * prefers-reduced-motion).
 */
export function Mark({ size = 26 }: { size?: number }) {
  const ref = useRef<HTMLImageElement>(null)
  useFrame(() => {
    if (ref.current) ref.current.style.opacity = String(0.7 + vis.beatPulse * 0.3)
  })
  return (
    <img ref={ref} src={easterMarkUrl} width={size} height={size} alt="" aria-hidden="true" draggable={false} className={styles.mark} />
  )
}

function RenderButton() {
  const phase = useStudio((s) => s.phase)
  // The one filled primary belongs to the Studio (UX #13); on other screens RENDER is an outline.
  const quiet = useUi((u) => u.screen !== 'studio')
  const prog = useRef<HTMLSpanElement>(null)
  useFrame((now) => {
    const el = prog.current
    if (!el) return
    const t0 = vis.finalT0
    el.style.transform = `scaleX(${t0 ? 1 - Math.exp(-(now - t0) / 1100) : 0})`
  })
  const engineUp = useEngine((s) => isEngineUsable(s.status))
  const label = phase === 'finalizing' ? 'RENDERING' : phase === 'synthesizing' && engineUp ? 'SYNTH…' : 'RENDER'
  return (
    <button
      type="button"
      className={styles.render}
      data-quiet={quiet || undefined}
      data-testid="render-button"
      aria-keyshortcuts="Meta+Enter"
      title="Final render: writes the file (⌘↩)"
      disabled={phase === 'finalizing'}
      onClick={() => void renderFinal()}
    >
      <span>{label}</span>
      <span className={styles.renderKey}>⌘↩</span>
      <span ref={prog} className={styles.renderProg} />
    </button>
  )
}

/** SETTINGS from STUDIO and back (⌘, too): one icon button, pressed while SETTINGS shows. */
function SettingsButton() {
  const onSettings = useUi((u) => u.screen === 'settings')
  const navigate = useUi((u) => u.navigate)
  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.iconChip}`}
      aria-label="Settings"
      aria-pressed={onSettings}
      title={onSettings ? 'Back to the studio (⌘,)' : 'Settings (⌘,)'}
      onClick={() => navigate(onSettings ? 'studio' : 'settings')}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="5" cy="4" r="1.8" fill="var(--vb-bg)" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="11" cy="8" r="1.8" fill="var(--vb-bg)" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="7" cy="12" r="1.8" fill="var(--vb-bg)" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </button>
  )
}

/** Draggable title bar: traffic-light space, mark, engine status, session controls, format, loudness, RENDER. */
export function TopBar() {
  const masterMode = useStudio((s) => s.masterMode)
  const settings = useSettings().data
  const update = useUpdateSettings()
  const fmt = currentFormat(settings)
  const cycleFormat = async () => {
    if (!settings) return
    const cycle = cycleOf(fmt.bit)
    const i = cycle.findIndex((f) => f.format === fmt.format && f.rate === fmt.rate)
    const next = cycle[(i + 1) % cycle.length]!
    try {
      await update.mutateAsync({
        ...settings,
        format: next.format,
        bit_depth: next.bit,
        master: { ...settings.master!, sample_rate: next.rate },
      })
      scheduleRender(250)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  return (
    <header className={styles.top} data-reveal="0">
      <div className={styles.lights} aria-hidden="true">
        {!bridge() && (
          <>
            <span />
            <span />
            <span />
          </>
        )}
      </div>
      <div className={styles.brand}>
        <Mark />
        <Lockup className={styles.lockup} />
      </div>
      <EngineStatus />
      <div className={styles.flex} />
      <TempoField />
      <KeyPicker />
      <BarsPicker />
      <button type="button" className={`${styles.chip} ${styles.topWide}`} title="Export format (click to change)" onClick={() => void cycleFormat()}>
        {formatLabel(fmt)}
      </button>
      <button
        type="button"
        className={styles.loud}
        aria-label={`Loudness ${masterMode}`}
        title="CLUB: −7 LUFS short-term, −1 dBTP · BAKE-IN: −6 dBFS peak, no limiting"
        onClick={() => {
          studio.setMasterMode(masterMode === 'club' ? 'bake' : 'club')
          scheduleRender(250)
        }}
      >
        {masterMode === 'club' ? 'CLUB' : masterMode === 'bake' ? 'BAKE-IN' : 'CUSTOM'}
      </button>
      <RenderButton />
      <SettingsButton />
    </header>
  )
}
