import type { ReactNode } from 'react'
import { Banner } from '@/components/feedback/Banner'
import { ScreenFx } from '@/components/feedback/ScreenFx'
import { UpdateBanner } from '@/components/updates/UpdateBanner'
import { useUi } from '@/state/ui'
import { TopBar } from './TopBar'
import styles from './layout.module.css'

/** Root grid (56px top bar, plus the update bar's row while it shows), the current screen, the wipe/banner layers. */
export function AppShell({ children, overlays }: { children: ReactNode; overlays?: ReactNode }) {
  const screen = useUi((s) => s.screen)
  const wiping = useUi((s) => Boolean(s.wipe))
  return (
    <div className={styles.shell} data-screen={screen} data-wipe={wiping || undefined}>
      <TopBar />
      <UpdateBanner />
      <main className={styles.main} id="main">
        {children}
        <Banner />
        <ScreenFx />
      </main>
      <div className={styles.scanlines} aria-hidden="true" />
      {overlays}
    </div>
  )
}
