import { Copy, MessageSquareText, PencilLine, ShieldCheck } from 'lucide-react'
import {
  buildAiDraftGuidance,
  conversationHistoryForMessage,
  inboxSummary,
  pageNameForMessage,
  selectInboxMessage,
  sortInboxMessages,
} from '../inboxModel'
import type { AutoMode, ManagedPage, PageMessage, PageMessageHistoryItem, SharedAdsInsightForPage } from '../types'

type InboxWorkspaceSummary = {
  avgHealth: number
  followers: number
  pages: number
  unread: number
}

type InboxWorkspaceProps = {
  adsInsight: SharedAdsInsightForPage | null
  autoMode: AutoMode
  messages: PageMessage[]
  onSelectedMessageChange?: (messageId: string) => void
  pages: ManagedPage[]
  selectedMessageId?: string
  summary: InboxWorkspaceSummary
}

export function InboxWorkspace({ adsInsight, autoMode, messages, onSelectedMessageChange, pages, selectedMessageId, summary }: InboxWorkspaceProps) {
  const sortedMessages = sortInboxMessages(messages)
  const selectedMessage = selectInboxMessage(messages, selectedMessageId)
  const selectedPage = selectedMessage ? pages.find((page) => page.id === selectedMessage.pageId) : pages[0]
  const selectedPageName = selectedMessage ? pageNameForMessage(selectedMessage, pages) : ''
  const guidance = buildAiDraftGuidance(selectedMessage)
  const conversationHistory = conversationHistoryForMessage(selectedMessage)
  const inbox = inboxSummary(messages)

  return (
    <section className="pa-inbox-workspace" aria-label="พื้นที่กล่องข้อความ">
      <aside className="pa-inbox-queue" aria-label="ข้อความที่ควรดู">
        <div className="pa-workspace-panel-head">
          <div>
            <h2>ข้อความที่ควรดู</h2>
            <p>{inbox.total ? `${formatNumber(inbox.unread)} รายการยังไม่ได้อ่าน จาก ${formatNumber(inbox.total)} ข้อความ` : 'ยังไม่มีข้อความใหม่จาก Meta ในช่วงนี้'}</p>
          </div>
          <span className="pa-soft-count">{formatNumber(inbox.highPriorityUnread)}</span>
        </div>

        <div className="pa-inbox-list">
          {sortedMessages.length ? (
            sortedMessages.map((message) => (
              <MessageQueueItem
                active={message.messageId === selectedMessage?.messageId}
                key={message.messageId}
                message={message}
                onSelect={onSelectedMessageChange}
                pageName={pageNameForMessage(message, pages)}
              />
            ))
          ) : (
            <div className="pa-inbox-empty">
              <MessageSquareText size={20} />
              <strong>ยังไม่มีข้อความใหม่จาก Meta ในช่วงนี้</strong>
              <p>เมื่อมีข้อความใหม่ ระบบจะแสดงรายการที่ควรตอบก่อนตรงนี้</p>
            </div>
          )}
        </div>
      </aside>

      <section className="pa-conversation-workspace" aria-label="รายละเอียดข้อความ">
        {selectedMessage ? (
          <>
            <div className="pa-conversation-head">
              <div>
                <span className="pa-kicker">{selectedPageName}</span>
                <h2>{selectedMessage.customerDisplayName}</h2>
                <p>
                  {selectedMessage.unread ? 'ยังไม่ได้อ่าน' : 'เปิดดูแล้ว'} · {priorityLabel(selectedMessage.priority)} ·{' '}
                  {formatDateTime(selectedMessage.receivedAt)}
                </p>
              </div>
              <span className={`pa-priority-pill ${selectedMessage.priority}`}>{priorityLabel(selectedMessage.priority)}</span>
            </div>

            <ConversationHistory history={conversationHistory} hasLoadedThread={Boolean(selectedMessage.history?.length)} />

            <div className="pa-ai-draft-card">
              <div className="pa-ai-draft-head">
                <span className="pa-ai-icon">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <strong>{guidance.title}</strong>
                  <p>{guidance.detail}</p>
                </div>
              </div>
              <textarea readOnly rows={5} value={guidance.draft} />
              <div className="pa-inbox-actions">
                <button className="pa-button primary" type="button">
                  <PencilLine size={15} />
                  แก้ก่อนส่ง
                </button>
                <button className="pa-button" type="button">
                  <Copy size={15} />
                  คัดลอกคำตอบ
                </button>
                <button className="pa-button" type="button">
                  ทำเครื่องหมายว่าตรวจแล้ว
                </button>
              </div>
              <p className="pa-human-note">AI ช่วยร่างเท่านั้น ข้อความนี้ต้องให้ทีมกดส่งเอง</p>
            </div>
          </>
        ) : (
          <div className="pa-conversation-empty">
            <MessageSquareText size={22} />
            <strong>เลือกข้อความทางซ้ายเพื่อดูรายละเอียดและร่างคำตอบ</strong>
            <p>ระบบจะแสดงบริบทเพจ สรุปจาก AI และคำตอบฉบับร่างให้ตรวจ</p>
          </div>
        )}
      </section>

      <aside className="pa-status-rail" aria-label="สถานะวันนี้">
        <StatusCard label="ข้อความจาก Meta" value={formatNumber(inbox.total)} detail={`${formatNumber(inbox.unread)} รายการยังไม่ได้อ่าน`} />
        <StatusCard
          label="ควรตอบก่อน"
          value={formatNumber(inbox.highPriorityUnread)}
          detail="รายการสำคัญในคิวข้อความ"
          tone={inbox.highPriorityUnread > 0 ? 'watch' : 'good'}
        />
        <StatusCard label="เพจที่เชื่อมต่อ" value={formatNumber(summary.pages)} detail={`${formatNumber(summary.followers)} ผู้ติดตามรวม`} />
        <StatusCard
          label="Auto"
          value={autoMode === 'on' ? 'เปิด' : 'ปิด'}
          detail={autoMode === 'on' ? 'ใช้เฉพาะงานความเสี่ยงต่ำ ไม่ส่งแชทแทนทีม' : 'แนะนำเท่านั้นและรอทีมกด'}
          tone={autoMode === 'on' ? 'watch' : 'neutral'}
        />
        <StatusCard
          label="เพจที่เลือก"
          value={selectedPage ? `${Math.round(selectedPage.healthScore)}%` : '-'}
          detail={selectedPage ? `${formatNumber(selectedPage.followers)} ผู้ติดตาม` : 'ยังไม่ได้เลือกข้อความ'}
        />
        <StatusCard
          label="บริบท Ads"
          value={adsInsight ? `${adsInsight.metrics.roas.toFixed(2)}x` : '-'}
          detail={adsInsight ? 'ใช้ประกอบคำแนะนำเท่านั้น' : 'ยังไม่มีบริบท Ads สำหรับข้อความนี้'}
        />
      </aside>
    </section>
  )
}

function ConversationHistory({ hasLoadedThread, history }: { hasLoadedThread: boolean; history: PageMessageHistoryItem[] }) {
  return (
    <section className="pa-history-card" aria-label="ประวัติแชท">
      <div className="pa-history-head">
        <div>
          <strong>ประวัติแชท</strong>
          <p>{history.length > 1 ? `${formatNumber(history.length)} ข้อความในบทสนทนานี้` : 'ข้อความล่าสุดที่โหลดมา'}</p>
        </div>
        <span>{hasLoadedThread ? 'จาก Meta' : 'ข้อความล่าสุด'}</span>
      </div>

      <div className="pa-chat-timeline">
        {history.map((item) => (
          <article className={`pa-chat-bubble ${item.senderRole}`} key={item.messageId}>
            <div>
              <strong>{senderRoleLabel(item.senderRole, item.senderName)}</strong>
              <span>{formatDateTime(item.createdAt)}</span>
            </div>
            <p>{item.text}</p>
          </article>
        ))}
      </div>

      <p className="pa-history-note">
        {hasLoadedThread ? 'แสดงข้อความย้อนหลังที่โหลดจาก Meta' : 'มีเฉพาะข้อความล่าสุดจากข้อมูลที่โหลดมา'}
      </p>
    </section>
  )
}

function MessageQueueItem({
  active,
  message,
  onSelect,
  pageName,
}: {
  active: boolean
  message: PageMessage
  onSelect?: (messageId: string) => void
  pageName: string
}) {
  return (
    <button
      aria-current={active ? 'true' : undefined}
      className={`pa-inbox-item ${active ? 'active' : ''} ${message.unread ? 'unread' : ''}`}
      onClick={() => onSelect?.(message.messageId)}
      type="button"
    >
      <span className="pa-avatar">{initials(message.customerDisplayName)}</span>
      <span className="pa-inbox-item-copy">
        <span>
          <strong>{message.customerDisplayName}</strong>
          <span>{formatDateTime(message.receivedAt)}</span>
        </span>
        <p>{message.textExcerpt}</p>
        <span className="pa-inbox-item-meta">
          <span>{pageName}</span>
          <span>{message.unread ? 'ยังไม่ได้อ่าน' : 'เปิดดูแล้ว'}</span>
        </span>
      </span>
    </button>
  )
}

function StatusCard({
  detail,
  label,
  tone = 'neutral',
  value,
}: {
  detail: string
  label: string
  tone?: 'good' | 'watch' | 'neutral'
  value: string
}) {
  return (
    <article className={`pa-status-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'C'
}

function priorityLabel(priority: PageMessage['priority']) {
  if (priority === 'high') return 'ควรตอบก่อน'
  if (priority === 'medium') return 'ติดตาม'
  return 'ปกติ'
}

function senderRoleLabel(role: PageMessageHistoryItem['senderRole'], senderName: string) {
  if (role === 'page') return senderName || 'ทีมเพจ'
  if (role === 'customer') return senderName || 'ลูกค้า'
  return senderName || 'ไม่ทราบผู้ส่ง'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)
}

function formatDateTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'ไม่ทราบเวลา'

  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(time))
}
