// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingProcessing, type BookingProcessingAdapter } from '../../src/apps/pmc-mini-app/BookingProcessing'
import type { BookingDraftProjection } from '../../src/apps/pmc-mini-app/contracts'

afterEach(() => { cleanup(); vi.useRealTimers() })
beforeEach(() => vi.useFakeTimers())

describe('PMC Mini App async booking processing', () => {
  it('polls persisted state every 2.5 seconds for 30 seconds and every 5 seconds afterward', async () => {
    const adapter = processingAdapter()
    render(<BookingProcessing draft={queuedDraft()} adapter={adapter} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(adapter.load).toHaveBeenCalledTimes(12)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(adapter.load).toHaveBeenCalledTimes(18)
    await act(async () => { await vi.advanceTimersByTimeAsync(240_000) })
    expect(adapter.load).toHaveBeenCalledTimes(66)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(adapter.load).toHaveBeenCalledTimes(66)
  })

  it('returns home automatically two seconds after persisted confirmation', async () => {
    const onExit = vi.fn()
    const confirmed = { ...queuedDraft(), state: 'CONFIRMED' as const, caseId: 'PMC-260828-0001', confirmationStatus: 'CONFIRMED' as const }
    render(<BookingProcessing draft={queuedDraft()} adapter={processingAdapter(confirmed)} onExit={onExit} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(2_500) })
    expect(screen.getByRole('heading', { name: 'PMC-260828-0001' })).toBeVisible()
    expect(onExit).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999) })
    expect(onExit).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('stops polling when the server projection becomes terminal and gives close-safe confirmation copy', async () => {
    const confirmed = { ...queuedDraft(), state: 'CONFIRMED_WITH_RETRY' as const, caseId: 'PMC-260828-0001', confirmationStatus: 'CONFIRMED' as const, safeErrorCode: 'DOWNSTREAM_RETRY' }
    const adapter = processingAdapter(confirmed)
    const view = render(<BookingProcessing draft={queuedDraft()} adapter={adapter} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(2_500) })
    expect(screen.getByRole('heading', { name: 'PMC-260828-0001' })).toBeVisible()
    expect(screen.getByText(/CONFIRMED_WITH_RETRY/)).toBeVisible()
    expect(screen.getByText(/ปิดหน้านี้ได้/)).toBeVisible()
    expect(view.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(adapter.load).toHaveBeenCalledOnce()
  })

  it('shows review-only copy without telling staff to submit again', () => {
    render(<BookingProcessing draft={{ ...queuedDraft(), state: 'NEEDS_REVIEW', safeErrorCode: 'BOOKING_NEEDS_REVIEW' }} adapter={processingAdapter()} />)

    expect(screen.getByText(/ผู้ดูแลตรวจสอบ/)).toBeVisible()
    expect(screen.queryByText(/ส่งรายการอีกครั้ง|ยืนยันบันทึกอีกครั้ง|submit again/i)).not.toBeInTheDocument()
  })
})

function processingAdapter(next: BookingDraftProjection = queuedDraft()): BookingProcessingAdapter {
  return { load: vi.fn(async () => structuredClone(next)) }
}

function queuedDraft(): BookingDraftProjection {
  return {
    draftId: 'draft-1', requestId: 'request-1', state: 'QUEUED', retentionState: '', version: 5, input: null,
    paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null, caseId: null, safeErrorCode: null,
    queuedAt: '2026-08-28T10:00:00.000Z', lastProgressAt: null,
  }
}
