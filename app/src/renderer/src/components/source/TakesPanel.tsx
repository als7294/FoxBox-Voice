import { useCallback, useEffect, useRef, useState } from 'react'
import { beatSeconds } from '@/audio/grid'
import { audioContext } from '@/audio/player'
import { click, MicError, MicRecorder } from '@/audio/recorder'
import { Button } from '@/components/common/Button'
import { PrivacyHelp } from '@/components/common/PrivacyHelp'
import { bridge } from '@/env'
import { renderNow } from '@/state/renderController'
import { studio, useStudio } from '@/state/studio'
import { toast } from '@/state/toasts'
import { clamp, mmss } from '@/visuals/canvas'
import { drawStrip, type RecInputs } from '@/visuals/draw'
import { useFrame } from '@/visuals/frame'
import { pushInputLevel, vis } from '@/visuals/state'
import { theme } from '@/visuals/theme'
import { CleanupControl } from './CleanupControl'
import { InputMeter } from './InputMeter'
import { TakeList } from './TakeList'
import { addTake, setTakeShortcut, uploadTake } from './takes'
import { TranscriptEditor } from './TranscriptEditor'
import styles from './source.module.css'

type RecState = 'idle' | 'count' | 'rec'
const COUNT_IN_BEATS = 3
const MAX_SECONDS = 120
const DEVICE_KEY = 'fvwks-mic'

function savedDevice(): string {
  try {
    return window.localStorage.getItem(DEVICE_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * RECORD: input device, REC (3-beat count-in at the session BPM, auto-stop at the bar count), the scrolling input
 * strip and meter, the active take's transcript and the takes. Any take can be USEd as the source. Voice only.
 */
export function TakesPanel() {
  const [state, setState] = useState<RecState>('idle')
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState<MicError | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState(savedDevice)
  const rec = useRef<MicRecorder | null>(null)
  const timing = useRef({ countT0: 0, recT0: 0, beatMs: 500 })
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const strip = useRef<HTMLCanvasElement>(null)
  const timeEl = useRef<HTMLSpanElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const bpm = useStudio((s) => s.bpm)
  const bars = useStudio((s) => s.bars)
  const takes = useStudio((s) => s.takes)
  const activeId = useStudio((s) => s.activeTakeId)
  const presetName = useStudio((s) => s.presetName)

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices()
      setDevices((all ?? []).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'))
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
      if (countTimer.current) clearTimeout(countTimer.current)
      rec.current?.close()
      rec.current = null
    }
  }, [refreshDevices])

  const stop = useCallback(async () => {
    const r = rec.current
    if (!r || !r.isRecording) return
    setBusy(true)
    const pcm = await r.stop()
    setState('idle')
    setBusy(false)
    const take = addTake(pcm)
    if (!take) return
    requestAnimationFrame(() => {
      document.querySelector(`[data-take="${take.id}"]`)?.animate?.(
        [
          { opacity: 0, transform: 'translateY(-8px)', clipPath: 'inset(0 100% 0 0)' },
          { opacity: 1, offset: 0.5 },
          { opacity: 0.4, offset: 0.6 },
          { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' },
        ],
        { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' },
      )
    })
  }, [])

  const start = useCallback(async () => {
    setDenied(null)
    setBusy(true)
    try {
      rec.current ??= await MicRecorder.open(deviceId || undefined)
    } catch (err) {
      setBusy(false)
      const e = err instanceof MicError ? err : new MicError('unknown', (err as Error).message)
      if (e.kind === 'denied') setDenied(e)
      else toast.error('MICROPHONE UNAVAILABLE', { detail: e.message })
      return
    }
    setBusy(false)
    void refreshDevices()
    const ctx = audioContext()
    await ctx.resume()
    const beat = beatSeconds(useStudio.getState().bpm)
    const t0 = ctx.currentTime + 0.05
    for (let i = 0; i < COUNT_IN_BEATS; i++) click(ctx, t0 + i * beat, i === 0)
    timing.current = { ...timing.current, countT0: performance.now() + 50, beatMs: beat * 1000 }
    setState('count')
    countTimer.current = setTimeout(
      () => {
        countTimer.current = null
        rec.current?.start()
        timing.current.recT0 = performance.now()
        setState('rec')
      },
      COUNT_IN_BEATS * beat * 1000 + 50,
    )
  }, [deviceId, refreshDevices])

  const toggle = useCallback(() => {
    const s = stateRef.current
    if (busy) return
    if (s === 'rec') void stop()
    else if (s === 'count') {
      if (countTimer.current) clearTimeout(countTimer.current)
      countTimer.current = null
      setState('idle')
    } else void start()
  }, [busy, start, stop])

  useEffect(() => {
    setTakeShortcut(toggle)
    return () => setTakeShortcut(null)
  }, [toggle])

  useFrame((now) => {
    const r = rec.current
    const peak = r ? r.level().peak : 0
    pushInputLevel(peak > 0 ? clamp(1 + (20 * Math.log10(peak)) / 48) : 0, now)
    const s = stateRef.current
    const t = timing.current
    const st = useStudio.getState()
    if (s === 'rec' && r) {
      const el = r.elapsed
      const target = typeof st.bars === 'number' ? (st.bars * 240) / st.bpm : 0
      if ((target && el >= target) || el >= MAX_SECONDS) void stop()
    }
    const el = timeEl.current
    if (el) {
      let text = '00:00.00'
      if (s === 'rec') {
        const sec = (now - t.recT0) / 1000
        const bd = 240 / st.bpm
        text = `${mmss(sec)}  ·  BAR ${Math.floor(sec / bd) + 1}.${Math.floor((sec % bd) / (bd / 4)) + 1}`
      } else if (s === 'count') text = 'COUNT-IN'
      if (el.textContent !== text) el.textContent = text
    }
    const o: RecInputs = {
      th: theme(),
      now,
      state: s,
      bpm: st.bpm,
      bars: typeof st.bars === 'number' ? st.bars : null,
      recT0: t.recT0,
      countT0: t.countT0,
      beatMs: t.beatMs,
      hist: vis.inHist,
      ts: vis.inTs,
      hi: vis.hi,
      lvl: vis.inLvl,
      pk: vis.inPk,
    }
    drawStrip(strip.current, o)
  })

  if (denied) {
    const b = bridge()
    return (
      <div className={styles.denied} role="alert">
        <div className={styles.deniedMark} aria-hidden="true">
          ✕
        </div>
        <span className={styles.deniedTitle}>MIC ACCESS IS OFF</span>
        <PrivacyHelp kind="mic" also="TYPE and IMPORT still work." />
        {b && (
          <Button variant="ink" onClick={() => void b.openMicSettings()}>
            OPEN PRIVACY SETTINGS
          </Button>
        )}
        <Button variant="ghost" onClick={() => void start()}>
          TRY AGAIN
        </Button>
      </div>
    )
  }

  const label =
    state === 'idle'
      ? `COUNT-IN ${COUNT_IN_BEATS} BEATS @ ${Math.round(bpm)} · ${typeof bars === 'number' ? `AUTO-STOP AT ${bars} BARS` : bars === 'auto' ? 'AUTO LENGTH' : 'FREE LENGTH'}`
      : state === 'count'
        ? 'GET READY'
        : 'RECORDING · CLICK TO STOP'
  const rate = rec.current?.sampleRate ?? audioContext().sampleRate
  return (
    <div className={styles.record}>
      <div className={styles.setup}>
        <div className={styles.inputRow}>
          <span className={styles.kicker}>INPUT</span>
          <select
            className={styles.device}
            aria-label="Input device"
            value={deviceId}
            disabled={state !== 'idle' || busy}
            onChange={(e) => {
              const id = e.target.value
              setDeviceId(id)
              try {
                window.localStorage.setItem(DEVICE_KEY, id)
              } catch {
                // private mode: remembered for the session only
              }
              // Reopen on the chosen device next time.
              rec.current?.close()
              rec.current = null
            }}
          >
            <option value="">DEFAULT INPUT</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `MICROPHONE ${i + 1}`}
              </option>
            ))}
          </select>
          <span className={styles.rate}>{Math.round(rate / 1000)}k · MONO</span>
        </div>
        <CleanupControl />
      </div>
      <div className={styles.transport}>
        <div className={styles.recInfo}>
          <span ref={timeEl} className={styles.recTime} aria-hidden="true">
            00:00.00
          </span>
          <span className={styles.recLabel} data-state={state} role="status">
            {label}
          </span>
        </div>
        <button
          type="button"
          className={styles.recHero}
          data-state={state}
          aria-label={state === 'rec' ? 'Stop recording' : state === 'count' ? 'Cancel count-in' : 'Start recording'}
          aria-keyshortcuts="R"
          disabled={busy}
          onClick={toggle}
        >
          <span className={styles.recDot} aria-hidden="true" />
          {state === 'count' ? 'READY' : state === 'rec' ? 'STOP' : 'REC'}
          {state === 'idle' && (
            <kbd className={styles.recKey} aria-hidden="true">
              R
            </kbd>
          )}
        </button>
      </div>
      <div className={styles.meters}>
        <div className={styles.strip}>
          <canvas ref={strip} className={styles.canvas} aria-hidden="true" />
        </div>
        <InputMeter />
      </div>
      <TranscriptEditor />
      <div className={styles.takesHead}>
        <span className={styles.kicker}>TAKES · {takes.length}</span>
        {takes.length > 0 && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              for (const t of useStudio.getState().takes) studio.removeTake(t.id)
            }}
          >
            CLEAR
          </button>
        )}
      </div>
      <TakeList
        takes={takes}
        activeId={activeId}
        onUse={(id) => {
          const t = useStudio.getState().takes.find((x) => x.id === id)
          studio.selectTake(id)
          if (t) toast.success(`${t.name} → SOURCE`, { detail: `Masking with ${presetName ?? 'CUSTOM'} · ${t.durationS.toFixed(2)} s` })
          if (useStudio.getState().source) void renderNow('preview')
        }}
        onRetry={(id) => {
          const t = useStudio.getState().takes.find((x) => x.id === id)
          if (t) void uploadTake(t)
        }}
      />
    </div>
  )
}
