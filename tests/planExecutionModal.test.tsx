import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PlanExecutionModal } from '../src/App'

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
            action: 'ขออนุมัติทดสอบเปิดแคมเปญแบบค่อยเป็นค่อยไป',
            targetName: 'ตัวรี MSG เติมไขมัน 9900 CA เพจFifth 20.6.66 - สำเนา',
            execution: {
              endpoint: '/api/meta/object-status',
              method: 'POST',
              objectType: 'campaign',
              objectId: '23855571859560528',
              status: 'PAUSED',
              label: 'คงสถานะพักแคมเปญใน Meta: ตัวรี MSG เติมไขมัน 9900 CA เพจFifth 20.6.66 - สำเนา',
            },
          },
          status: 'ready',
          steps: [
            'ตรวจข้อมูลก่อนทำ: ROAS เป็นบวกและ conversion ดี',
            'ส่งคำสั่งไป Meta: คงสถานะพักแคมเปญใน Meta',
          ],
        }}
        error=""
        isExecuting={false}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onStart={vi.fn()}
      />,
    )

    expect(html).toContain('ตรวจคำสั่ง Meta ก่อนส่งจริง')
    expect(html).toContain('แผนที่อนุมัติ')
    expect(html).toContain('คำสั่ง Meta ที่จะส่ง')
    expect(html).toContain('ยืนยันส่งคำสั่งไป Meta')
    expect(html).toContain('กลับไปดูรายการแผน')
    expect(html).not.toContain('ดำเนินการแผนต่อ')
    expect(html).not.toContain('Action ใน Meta')
  })
})
