import { useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, Clock3 } from 'lucide-react'
import type { BookingDraftProjection } from './contracts'
import { isBookingTerminalState } from './contracts'

export interface BookingProcessingAdapter {
  load(draftId: string, signal: AbortSignal): Promise<BookingDraftProjection>
}

export function BookingProcessing({
  draft,
  adapter,
  onProjection,
  onExit,
}: {
  draft: BookingDraftProjection
  adapter: BookingProcessingAdapter
  onProjection?: (draft: BookingDraftProjection) => void
  onExit?: () => void
}) {
  const [polledProjection, setPolledProjection] = useState(draft)
  const projection = polledProjection.draftId === draft.draftId && polledProjection.version >= draft.version
    ? polledProjection
    : draft
  const latestProjection = useRef(projection)

  useEffect(() => {
    latestProjection.current = projection
  }, [projection])

  useEffect(() => {
    if (isBookingTerminalState(latestProjection.current.state)) return
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    const startedAt = Date.now()

    const poll = () => {
      const elapsed = Date.now() - startedAt
      if (elapsed >= 60_000 || cancelled) return
      const delay = elapsed < 30_000 ? 2_500 : 5_000
      timeout = setTimeout(() => {
        if (cancelled) return
        controller?.abort()
        controller = new AbortController()
        void adapter.load(latestProjection.current.draftId, controller.signal)
          .then((next) => {
            if (cancelled) return
            latestProjection.current = next
            setPolledProjection(next)
            onProjection?.(next)
            if (!isBookingTerminalState(next.state)) poll()
          })
          .catch((error: unknown) => {
            if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) poll()
          })
      }, delay)
    }

    poll()
    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
      controller?.abort()
    }
  }, [adapter, draft.draftId, onProjection])

  const terminal = isBookingTerminalState(projection.state)
  const confirmed = projection.state === 'CONFIRMED' || projection.state === 'CONFIRMED_WITH_RETRY'

  return <main className="pmc-booking-processing">
    <div className={`pmc-processing-icon ${terminal ? (confirmed ? 'confirmed' : 'review') : 'waiting'}`}>
      {confirmed ? <CircleCheck aria-hidden="true" /> : terminal ? <CircleAlert aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
    </div>
    <div className="pmc-processing-status" aria-live="polite" aria-atomic="true">
      {!terminal && <><p className="pmc-processing-kicker">รับรายการแล้ว</p><h1>ระบบกำลังดำเนินการ</h1><p>คุณปิดหน้านี้ได้ ระบบจะบันทึกผลจากรายการนี้ให้</p></>}
      {confirmed && <><p className="pmc-processing-kicker">ยืนยันการจองแล้ว</p><h1>{projection.caseId ?? 'กำลังอัปเดตเลขเคส'}</h1><p>{projection.state === 'CONFIRMED_WITH_RETRY' ? 'CONFIRMED_WITH_RETRY — ระบบดำเนินการสำเร็จหลังลองส่งอีกครั้ง' : 'ยืนยันวันนัดแล้ว'}</p><p>คุณปิดหน้านี้ได้</p></>}
      {projection.state === 'NEEDS_REVIEW' && <><p className="pmc-processing-kicker">ต้องตรวจสอบเพิ่มเติม</p><h1>ผู้ดูแลตรวจสอบรายการนี้</h1><p>กรุณารอการติดต่อจากผู้ดูแล คุณไม่ต้องส่งรายการนี้อีกครั้ง</p></>}
      {(projection.state === 'CANCELLED' || projection.state === 'EXPIRED') && <><p className="pmc-processing-kicker">รายการสิ้นสุดแล้ว</p><h1>ไม่สามารถดำเนินการต่อได้</h1><p>หากต้องการความช่วยเหลือ กรุณาติดต่อผู้ดูแล</p></>}
    </div>
    <p className="pmc-processing-case">เลขอ้างอิง: {projection.requestId}</p>
    {terminal && <button type="button" className="pmc-secondary-button" onClick={onExit}>กลับหน้าหลัก</button>}
  </main>
}
