import { describe, expect, it, vi } from 'vitest'
import {
  CLINIC_REPORT_SOURCE_TYPES,
  seedClinicReportCache,
} from '../../scripts/seed-clinic-report-cache.mjs'

const PROJECT = 'project-2099d92f-51c8-4d2b-a8c'
const BRANCH = '11111111-2222-4333-8444-555555555555'
const NOW = '2026-08-29T10:00:00.000Z'

describe('clinic report cache seeding', () => {
  it('seeds all 13 source reports sequentially and emits aggregate evidence only', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const order: string[] = []
    const coordinator = {
      async scheduledRefresh(query: { reportType: string }) {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        order.push(query.reportType)
        await Promise.resolve()
        inFlight -= 1
        return {
          data: [{
            patientName: 'must-not-leak', patientUuid: 'private-id', sourceUuid: 'private-source',
            totalSatang: 300, paidAmountSatang: 100, refundAmountSatang: 50,
          }],
          source: 'LIVE', fetchedAt: NOW, lastSuccessAt: NOW,
          refreshing: false, stale: false, warningCode: null,
        }
      },
    }

    const result = await seedClinicReportCache(
      ['--allow-readonly-production', '--project', PROJECT, '--date', '2026-08-29'],
      environment(), dependencies({ coordinator }),
    )

    expect(order).toEqual([...CLINIC_REPORT_SOURCE_TYPES])
    expect(maxInFlight).toBe(1)
    expect(result).toEqual({
      mode: 'cache-seed', date: '2026-08-29', sequential: true,
      reports: CLINIC_REPORT_SOURCE_TYPES.map((reportType) => ({
        reportType, count: 1, totalSatang: 300, paidAmountSatang: 100, refundAmountSatang: 50,
        warningCode: null, lastSuccessAt: NOW,
      })),
    })
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(JSON.stringify(result)).not.toContain('private-id')
    expect(JSON.stringify(result)).not.toContain('private-source')
  })

  it('uses the approved one-day window for every source report', async () => {
    const coordinator = { scheduledRefresh: vi.fn(async () => emptyEnvelope()) }

    await seedClinicReportCache(
      ['--allow-readonly-production', '--project', PROJECT, '--date', '2026-08-29'],
      environment(), dependencies({ coordinator }),
    )

    expect(coordinator.scheduledRefresh).toHaveBeenCalledTimes(13)
    for (const [query] of coordinator.scheduledRefresh.mock.calls) {
      expect(query.filters).toEqual({ branchUuid: BRANCH, startDate: '2026-08-29', endDate: '2026-08-29' })
    }
  })

  it('refuses production access without explicit approval, project, and one-day date', async () => {
    await expect(seedClinicReportCache(['--date', '2026-08-29'], environment(), dependencies()))
      .rejects.toThrow('Explicit read-only production approval is required')
    await expect(seedClinicReportCache(
      ['--allow-readonly-production', '--project', 'other-project', '--date', '2026-08-29'], environment(), dependencies(),
    )).rejects.toThrow('Explicit read-only production approval is required')
    await expect(seedClinicReportCache(
      ['--allow-readonly-production', '--project', PROJECT, '--date', '2026-08-29T00:00:00Z'], environment(), dependencies(),
    )).rejects.toThrow('A strict one-day ISO date is required')
  })
})

function environment() {
  return {
    PMC_SPREADSHEET_ID: 'spreadsheet-id', PMC_DRIVE_INTAKE_FOLDER_ID: 'intake-folder-id',
    JERA_DEFAULT_BRANCH_UUID: BRANCH, JERA_SYNC_INTERVAL_MINUTES: '15',
  }
}

function dependencies({ coordinator = { scheduledRefresh: vi.fn(async () => emptyEnvelope()) } } = {}) {
  return { coordinator }
}

function emptyEnvelope() {
  return {
    data: [], source: 'LIVE', fetchedAt: NOW, lastSuccessAt: NOW,
    refreshing: false, stale: false, warningCode: null,
  }
}
