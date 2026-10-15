import type { Health } from '@/api/types'
import { Button } from '@/components/common/Button'
import { AnimatedFoxMark } from '@/components/common/AnimatedFoxMark'
import { TextField } from '@/components/common/Fields'
import { Lockup } from '@/components/common/Lockup'
import { useWelcomeHome, WelcomeHome } from '@/components/common/WelcomeHome'
import styles from './setup.module.css'

/** Screen 1: what this is, what it needs, START (RESUME after an interrupted install). */
export function SetupWelcome({
  resume,
  health,
  engineNote,
  translocated = false,
  artist,
  onArtist,
  onStart,
}: {
  /** An earlier install was interrupted (partial downloads are on disk, or Setup was started before). */
  resume: boolean
  health: Health | null
  /** Why the engine isn't answering yet, if it isn't. */
  engineNote: string | null
  /** macOS is running a read-only copy of the app (opened from Downloads or the disk image). */
  translocated?: boolean
  /** Optional: the artist tag on exports (Settings → Naming). */
  artist: string
  onArtist(name: string): void
  onStart(): void
}) {
  const home = useWelcomeHome()
  const failed = health?.state === 'error' && health.message
  return (
    <div className={styles.welcome}>
      <AnimatedFoxMark size={64} className={styles.bigMark} />
      <div>
        <div className={styles.kicker}>01 / Welcome</div>
        <h1 className={styles.welcomeTitle}>
          <Lockup className={styles.welcomeLockup} />
        </h1>
        <p className={styles.tagline}>Type a line. Get a finished vocal.</p>
      </div>
      {translocated && (
        <div className={styles.notice} role="alert">
          <strong>Move FoxBox Voice to Applications, then open it again.</strong>
          <span>It is running from Downloads or the disk image, where macOS won't let it install its voices.</span>
        </div>
      )}
      <p className={styles.lede}>
        {resume ? 'Picking up where the last install stopped. What is already downloaded stays.' : 'Installing the sound engine.'} The voices
        download once; after that everything runs on this Mac.
      </p>
      <p className={styles.note}>Requires macOS 14 or later on Apple silicon, and an internet connection for the first download.</p>
      {failed && (
        <div className={styles.notice} role="status">
          <strong>The first download stopped.</strong>
          <span>{health.message}</span>
        </div>
      )}
      {engineNote && <p className={styles.note}>{engineNote}</p>}
      <div className={styles.artist}>
        <TextField
          label="Your artist name"
          value={artist}
          placeholder="Optional"
          hint="Tags your exports. Change it any time in Settings."
          onChange={(v) => {
            onArtist(v)
            home.check(v)
          }}
        />
        {home.welcome && <WelcomeHome welcome={home.welcome} onDone={home.done} />}
      </div>
      <div>
        <Button variant="primary" size="lg" onClick={onStart}>
          {resume ? 'Resume setup' : 'Start'}
        </Button>
      </div>
    </div>
  )
}
