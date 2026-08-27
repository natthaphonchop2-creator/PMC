import type { MiniAppSession } from './contracts'
import { Home } from './Home'

export function PmcMiniApp({ initialSession }: { initialSession?: MiniAppSession }) {
  if (!initialSession) {
    return (
      <main className="pmc-mini-app-notice" aria-live="polite">
        <p>กำลังเปิดระบบ</p>
      </main>
    )
  }

  return <Home session={initialSession} />
}
