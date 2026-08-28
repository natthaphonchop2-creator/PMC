// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Home } from '../../src/apps/pmc-mini-app/Home'
import { AdditionalReportMenu, ReportCenter } from '../../src/apps/pmc-mini-app/ReportCenter'
import { ReportPage } from '../../src/apps/pmc-mini-app/ReportPage'
import { defaultReportFilters } from '../../src/apps/pmc-mini-app/reports'

afterEach(cleanup)

function assertNoProviderName(container: HTMLElement) {
  expect(container).not.toHaveTextContent(/jera/i)
  expect(container.querySelectorAll('[aria-label*="JERA" i]')).toHaveLength(0)
}

describe('PMC Clinic Reports product language', () => {
  it('brands the enabled Home card as รายงานคลินิก', () => {
    const view = render(<Home
      session={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      reportingEnabled stockEnabled={false} onAction={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: 'รายงานคลินิก' })).toBeVisible()
    expect(screen.getByText('ดูข้อมูลการเงิน นัดหมาย และการดำเนินงาน')).toBeVisible()
    assertNoProviderName(view.container)
  })

  it('removes the provider name from report menus and pages', () => {
    const adapter = {
      load: vi.fn(async () => ({
        data: { totals: {} }, source: 'CACHE' as const, fetchedAt: null,
        lastSuccessAt: '2026-08-29T00:00:00.000Z', refreshing: false, stale: false, warningCode: null,
      })),
      refresh: vi.fn(async () => ({ accepted: true as const, correlationId: 'refresh-1' })),
    }
    const center = render(<ReportCenter
      filters={defaultReportFilters('2026-08-29')} onFiltersChange={vi.fn()} onSelect={vi.fn()}
    />)
    expect(screen.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
    expect(screen.getByText('ข้อมูลจากระบบคลินิกแบบอ่านอย่างเดียว')).toBeVisible()
    assertNoProviderName(center.container)
    center.unmount()

    const additional = render(<AdditionalReportMenu onBack={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('CLINIC REPORT')).toBeVisible()
    expect(screen.getAllByText('ดูข้อมูลรายงาน')).toHaveLength(8)
    assertNoProviderName(additional.container)
    additional.unmount()

    const page = render(<ReportPage
      reportType="PAYMENT" filters={defaultReportFilters('2026-08-29')}
      onFiltersChange={vi.fn()} adapter={adapter} onBack={vi.fn()} pollDelayMs={0}
    />)
    expect(screen.getByText('CLINIC REPORT')).toBeVisible()
    assertNoProviderName(page.container)
  })
})
