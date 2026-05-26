import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PlanExecutionModal, withResolvedPlanExecution } from '../src/App'
import type { WorkspaceData } from '../src/types'

describe('PlanExecutionModal', () => {
  it('separates the approved plan from the Meta command before execution', () => {
    const html = renderToStaticMarkup(
      <PlanExecutionModal
        draft={{
          recommendation: {
            id: 'rec-1',
            title: 'เปิดแคมเปญที่มีสัญญาณดี',
            evidence: 'ROAS เป็นบวกและ conversion ดี',
            risk: 'Medium',
            confidence: 78,
            guardrail: 'หยุดถ้า CPA หรือ ROAS แย่กว่าเกณฑ์',
            impact: 'เพิ่มงบอย่างค่อยเป็นค่อยไปและติดตามรายวัน',
            action: 'ขออนุมัติพักแคมเปญที่ยังใช้เงินแต่ไม่มีผลลัพธ์',
            targetName: 'ตัวรี MSG เติมไขมัน 9900 CA เพจFifth 20.6.66 - สำเนา',
            execution: {
              endpoint: '/api/meta/object-status',
              method: 'POST',
              objectType: 'campaign',
              objectId: '23855571859560528',
              status: 'PAUSED',
              label: 'พักแคมเปญใน Meta: ตัวรี MSG เติมไขมัน 9900 CA เพจFifth 20.6.66 - สำเนา',
            },
          },
          status: 'ready',
          steps: [
            'ตรวจข้อมูลก่อนทำ: ROAS เป็นบวกและ conversion ดี',
            'ส่งคำสั่งไป Meta: พักแคมเปญใน Meta',
          ],
        }}
        error=""
        isExecuting={false}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onStart={vi.fn()}
      />,
    )

    expect(html).toContain('ตรวจคำสั่งก่อนส่งจริง')
    expect(html).toContain('แผนที่อนุมัติ')
    expect(html).toContain('คำสั่งที่จะส่ง')
    expect(html).toContain('ยืนยันส่งคำสั่ง')
    expect(html).toContain('กลับไปดูรายการแผน')
    expect(html).not.toContain('ดำเนินการแผนต่อ')
    expect(html).not.toContain('Action ใน Meta')
  })

  it('does not create a duplicate pause command for a campaign that is already paused', () => {
    const workspace = workspaceData({
      campaigns: [
        campaign({
          id: 'cmp-paused',
          name: 'แคมเปญที่พักอยู่แล้ว',
          deliveryStatus: 'paused',
          spend: 5000,
          conversions: 0,
          aiStatus: 'critical',
        }),
      ],
    })
    const recommendation = withResolvedPlanExecution({
      id: 'rec-keep-paused',
      title: 'ตรวจแคมเปญที่พักอยู่แล้ว',
      evidence: 'แคมเปญมี spend และไม่มี conversion ก่อนถูกพัก',
      risk: 'High',
      confidence: 84,
      guardrail: 'ตรวจ tracking และ offer ก่อนเปิดกลับ',
      impact: 'กันไม่ให้เปิดกลับโดยไม่มีแผนแก้ไข',
      action: 'คงสถานะพักไว้และตรวจสาเหตุก่อนเปิดกลับ',
      campaignId: 'cmp-paused',
      targetName: 'แคมเปญที่พักอยู่แล้ว',
    }, workspace)

    const html = renderToStaticMarkup(
      <PlanExecutionModal
        draft={{
          recommendation,
          status: 'ready',
          steps: [
            'ตรวจข้อมูลก่อนทำ: แคมเปญมี spend และไม่มี conversion ก่อนถูกพัก',
            'ดำเนินการหลัก: คงสถานะพักไว้และตรวจสาเหตุก่อนเปิดกลับ',
          ],
        }}
        error=""
        isExecuting={false}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onStart={vi.fn()}
      />,
    )

    expect(recommendation.execution).toBeUndefined()
    expect(html).toContain('ทำตามรายการตรวจของแผน')
    expect(html).toContain('ยังไม่มีคำสั่งที่ปลอดภัยพอให้ทำอัตโนมัติ')
    expect(html).not.toContain('คำสั่งที่จะส่ง')
    expect(html).not.toContain('ยืนยันส่งคำสั่ง')
    expect(html).not.toContain('คงสถานะพักแคมเปญใน Meta')
  })
})

function workspaceData(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    campaigns: [],
    serviceLines: [],
    appointmentStages: [],
    complianceReviews: [],
    insights: [],
    insightComponents: [],
    adSets: [],
    adInsights: [],
    actions: [],
    autoAds: [],
    tasks: [],
    memoryItems: [],
    auditTrail: [],
    trendData: [],
    channelPerformance: [],
    funnelMetrics: [],
    autoMode: 'suggest',
    updatedAt: '2026-05-22T00:00:00.000Z',
    ...overrides,
  }
}

function campaign(overrides: Partial<WorkspaceData['campaigns'][number]> = {}): WorkspaceData['campaigns'][number] {
  return {
    id: 'cmp-1',
    name: 'Campaign 1',
    objective: 'LEADS',
    deliveryStatus: 'active',
    budget: 0,
    spend: 0,
    revenue: 0,
    roas: 0,
    cpa: 0,
    ctr: 0,
    conversions: 0,
    frequency: 0,
    aiStatus: 'healthy',
    aiSummary: 'Healthy campaign',
    ...overrides,
  }
}
