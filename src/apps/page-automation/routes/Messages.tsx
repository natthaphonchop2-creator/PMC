import { Inbox, ShieldAlert } from 'lucide-react'
import { PageAutomationPanel, PageAutomationState } from '../components'
import { missingPermissionStates } from '../policy'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type Summary = {
  avgHealth: number
  followers: number
  pages: number
  unread: number
}

type MessagesProps = {
  adsInsight: SharedAdsInsightForPage | null
  autoMode: AutoMode
  messages: PageMessage[]
  pages: ManagedPage[]
  summary: Summary
}

export function Messages({ adsInsight, autoMode, messages, pages, summary }: MessagesProps) {
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const unknownPermissionPages = pages.filter((page) => page.permissions.length === 0)
  const missingMessagingPages = pages.filter((page) => hasMissingMessagingPermission(page))
  const selectedMessage = messages[0]
  const inboxPermissionNotice = inboxPermissionNoticeFor(unknownPermissionPages.length, missingMessagingPages.length)

  return (
    <div className="pa-grid">
      <PageAutomationPanel
        className="pa-span-8"
        subtitle="รวมข้อความ คอมเมนต์ และรายการที่ควรตอบจากทุกเพจ"
        title="กล่องข้อความรวม"
      >
        {messages.length ? (
          <div className="pa-message-list">
            {messages.map((message) => (
              <MessageItem key={message.messageId} message={message} pageName={pageById.get(message.pageId)?.name ?? 'เพจที่เชื่อมต่อ'} />
            ))}
          </div>
        ) : (
          <div className="pa-empty-state">
            {inboxPermissionNotice ? <ShieldAlert size={20} /> : <Inbox size={20} />}
            <div>
              <strong>{inboxPermissionNotice?.title ?? 'ยังไม่มีข้อความใหม่จาก Meta ในช่วงนี้'}</strong>
              <p>
                {inboxPermissionNotice?.detail ?? 'เมื่อมีข้อความใหม่ ระบบจะแสดงรายการที่ควรตอบก่อน'}
              </p>
            </div>
          </div>
        )}
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-4" subtitle="คำตอบจาก AI เป็นร่างให้ทีมตรวจ ไม่ส่งแทนทีม" title="การจัดลำดับข้อความ">
        <div className="pa-list">
          <PageAutomationState
            detail={autoMode === 'on' ? 'Auto เปิดอยู่ แต่ไม่ส่งข้อความลูกค้าแทนทีม' : 'คำแนะนำต้องให้ทีมกดส่งเอง'}
            tone="neutral"
            title="กติกาการตอบ"
          />
          <PageAutomationState
            detail={`${summary.unread} รายการยังไม่ได้อ่าน จาก ${summary.pages} เพจ`}
            tone={summary.unread > 0 ? 'watch' : 'good'}
            title="ข้อความรอตอบ"
          />
          <PageAutomationState
            detail={adsInsight ? `ROAS ${adsInsight.metrics.roas.toFixed(2)}x ใช้ประกอบการจัดลำดับ` : 'ยังไม่มีข้อมูล Ads สำหรับประกอบการจัดลำดับ'}
            tone={adsInsight ? 'good' : 'neutral'}
            title="บริบทจาก Ads"
          />
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-12" subtitle="ดูข้อความที่เลือก พร้อมสรุปและร่างคำตอบจาก AI" title="รายละเอียดข้อความ">
        {selectedMessage ? (
          <article className="pa-message-detail">
            <div>
              <span className={`pa-badge priority-${selectedMessage.priority}`}>{selectedMessage.priority}</span>
              <h3>{selectedMessage.customerDisplayName}</h3>
              <p>{selectedMessage.aiSummary ?? selectedMessage.textExcerpt}</p>
            </div>
            <div className="pa-message-detail-grid">
              <span>ประเภท {intentLabel(selectedMessage.intent)}</span>
              <span>สถานะ {statusLabel(selectedMessage.status)}</span>
              <span>ควรตอบก่อน {formatDateTime(selectedMessage.slaDueAt)}</span>
              <span>{selectedMessage.privacyFlags.length ? selectedMessage.privacyFlags.join(', ') : 'ไม่มีข้อมูลส่วนตัวที่ระบบพบ'}</span>
            </div>
            <label className="pa-field wide">
              <span>ร่างคำตอบ</span>
              <textarea
                readOnly
                rows={4}
                value="พื้นที่ร่างคำตอบเท่านั้น ทีมต้องตรวจ แก้ และกดส่งเองผ่านขั้นตอนที่อนุมัติไว้"
              />
            </label>
          </article>
        ) : (
          <PageAutomationState
            detail={conversationEmptyDetail(unknownPermissionPages.length, missingMessagingPages.length)}
            tone={unknownPermissionPages.length || missingMessagingPages.length ? 'watch' : 'neutral'}
            title="ยังไม่ได้เลือกข้อความ"
          />
        )}
      </PageAutomationPanel>
    </div>
  )
}

function MessageItem({ message, pageName }: { message: PageMessage; pageName: string }) {
  return (
    <article className={`pa-message-row ${message.unread ? 'unread' : ''}`}>
      <div className="pa-message-copy">
        <div className="pa-message-meta">
          <span>{channelLabel(message.channel)}</span>
          <span>{pageName}</span>
          <span>{formatDateTime(message.receivedAt)}</span>
        </div>
        <strong>{message.customerDisplayName}</strong>
        <p>{message.textExcerpt}</p>
      </div>
      <div className="pa-message-tags">
        <span className={`pa-badge priority-${message.priority}`}>{message.priority}</span>
        <span className="pa-badge">{intentLabel(message.intent)}</span>
        <span className={`pa-badge status-${message.status}`}>{statusLabel(message.status)}</span>
      </div>
    </article>
  )
}

function hasMissingMessagingPermission(page: ManagedPage) {
  return page.permissions.some((report) =>
    missingPermissionStates(report).some(
      (state) => state.feature === 'facebook_messages' || state.feature === 'instagram_messages',
    ),
  )
}

function inboxPermissionNoticeFor(unknownCount: number, missingMessagingCount: number) {
  if (unknownCount > 0) {
    return {
      title: 'ยังตรวจสิทธิ์ข้อความไม่ได้',
      detail: `มี ${unknownCount} เพจที่ยังไม่มีรายงานสิทธิ์ จึงยังยืนยันการอ่านกล่องข้อความไม่ได้`,
    }
  }

  if (missingMessagingCount > 0) {
    return {
      title: 'สิทธิ์ข้อความยังไม่ครบ',
      detail: `มี ${missingMessagingCount} เพจที่ต้องเพิ่มสิทธิ์ข้อความก่อน ระบบจึงจะอ่านกล่องข้อความได้`,
    }
  }

  return null
}

function conversationEmptyDetail(unknownCount: number, missingMessagingCount: number) {
  if (unknownCount > 0) {
    return 'ยังไม่มีรายงานสิทธิ์ของบางเพจ ตรวจสิทธิ์ Meta ก่อนสรุปว่าไม่มีข้อความใหม่'
  }

  if (missingMessagingCount > 0) {
    return 'ยังอ่านข้อความไม่ได้ เพราะสิทธิ์ข้อความของ Meta ยังไม่ครบ'
  }

  return 'เลือกข้อความหลังจากระบบโหลดข้อมูลจาก Meta'
}

function channelLabel(channel: PageMessage['channel']) {
  return channel.replaceAll('_', ' ')
}

function intentLabel(intent: PageMessage['intent']) {
  return intent.replaceAll('_', ' ')
}

function statusLabel(status: PageMessage['status']) {
  return status.replaceAll('_', ' ')
}

function formatDateTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value || '-'

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(time))
}
