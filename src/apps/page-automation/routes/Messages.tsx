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
        subtitle="Cross-page queue for messages, comments, mentions, reviews, and ad comments."
        title="Unified inbox"
      >
        {messages.length ? (
          <div className="pa-message-list">
            {messages.map((message) => (
              <MessageItem key={message.messageId} message={message} pageName={pageById.get(message.pageId)?.name ?? 'Unknown page'} />
            ))}
          </div>
        ) : (
          <div className="pa-empty-state">
            {inboxPermissionNotice ? <ShieldAlert size={20} /> : <Inbox size={20} />}
            <div>
              <strong>{inboxPermissionNotice?.title ?? 'No message data yet'}</strong>
              <p>
                {inboxPermissionNotice?.detail ?? 'The polling endpoint returned no messages for connected pages.'}
              </p>
            </div>
          </div>
        )}
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-4" subtitle="Inbox decisions remain operator-controlled in v1." title="Triage panel">
        <div className="pa-list">
          <PageAutomationState
            detail={autoMode === 'on' ? 'Auto ON does not send customer replies directly' : 'Reply suggestions require human send'}
            tone="neutral"
            title="Reply policy"
          />
          <PageAutomationState
            detail={`${summary.unread} unread across ${summary.pages} page${summary.pages === 1 ? '' : 's'}`}
            tone={summary.unread > 0 ? 'watch' : 'good'}
            title="Unread queue"
          />
          <PageAutomationState
            detail={adsInsight ? `Ads ROAS ${adsInsight.metrics.roas.toFixed(2)}x may inform triage context` : 'No Ads bridge context loaded'}
            tone={adsInsight ? 'good' : 'neutral'}
            title="Ads context"
          />
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-12" subtitle="Selected conversation preview with AI summary and SLA state." title="Conversation detail">
        {selectedMessage ? (
          <article className="pa-message-detail">
            <div>
              <span className={`pa-badge priority-${selectedMessage.priority}`}>{selectedMessage.priority}</span>
              <h3>{selectedMessage.customerDisplayName}</h3>
              <p>{selectedMessage.aiSummary ?? selectedMessage.textExcerpt}</p>
            </div>
            <div className="pa-message-detail-grid">
              <span>Intent {intentLabel(selectedMessage.intent)}</span>
              <span>Status {statusLabel(selectedMessage.status)}</span>
              <span>SLA {formatDateTime(selectedMessage.slaDueAt)}</span>
              <span>{selectedMessage.privacyFlags.length ? selectedMessage.privacyFlags.join(', ') : 'No privacy flag'}</span>
            </div>
            <label className="pa-field wide">
              <span>Reply draft</span>
              <textarea
                readOnly
                rows={4}
                value="Draft-only response area. Operators review and send from the approved Meta messaging flow."
              />
            </label>
          </article>
        ) : (
          <PageAutomationState
            detail={conversationEmptyDetail(unknownPermissionPages.length, missingMessagingPages.length)}
            tone={unknownPermissionPages.length || missingMessagingPages.length ? 'watch' : 'neutral'}
            title="No conversation selected"
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
      title: 'Permission state unknown',
      detail: `${unknownCount} page record${unknownCount === 1 ? '' : 's'} do not include permission reports yet, so inbox polling cannot be confirmed.`,
    }
  }

  if (missingMessagingCount > 0) {
    return {
      title: 'Messaging permission missing',
      detail: `${missingMessagingCount} page record${missingMessagingCount === 1 ? '' : 's'} need Meta messaging permissions before polling can populate this inbox.`,
    }
  }

  return null
}

function conversationEmptyDetail(unknownCount: number, missingMessagingCount: number) {
  if (unknownCount > 0) {
    return 'Permission state unknown for connected pages. Confirm Meta permission reports before treating this as an empty inbox.'
  }

  if (missingMessagingCount > 0) {
    return 'Missing Meta messaging permissions block message content.'
  }

  return 'Select a message after polling returns data.'
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
