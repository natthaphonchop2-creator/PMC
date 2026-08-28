import { ArrowLeft, ClipboardClock } from 'lucide-react'
import {
  formatQuantityMilli,
  type StockDocumentSummary,
  type StockHistoryPage,
  type StockTransactionType,
} from '../../../../shared/pmcStock'

export interface StockHistoryProps {
  page: StockHistoryPage
  canManageStock: boolean
  onLoadMore: (cursor: string) => void
  onBack?: () => void
  loadingMore?: boolean
  message?: string
}

export function StockHistory({
  page,
  canManageStock,
  onLoadMore,
  onBack,
  loadingMore = false,
  message = '',
}: StockHistoryProps) {
  const documents = [...page.documents].sort(compareNewestFirst)

  return <main className="pmc-stock-history">
    <header className="pmc-stock-flow-header">
      {onBack
        ? <button type="button" aria-label="ย้อนกลับหน้า Stock" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </button>
        : <span aria-hidden="true" />}
      <div>
        <p lang="en">IMMUTABLE LEDGER</p>
        <h1>ประวัติ Stock</h1>
        <span>ดูเอกสารย้อนหลังและรายละเอียดการเปลี่ยนแปลง</span>
      </div>
      <ClipboardClock aria-hidden="true" />
    </header>

    {message ? <p className="pmc-stock-flow-alert" role="alert" aria-live="assertive">{message}</p> : null}

    {documents.length > 0 ? <ol className="pmc-stock-history-list" aria-label="รายการประวัติ Stock">
      {documents.map((document) => <li key={document.documentId}>
        <details className="pmc-stock-history-document">
          <summary role="button" aria-label={`ดูรายละเอียด ${document.documentId}`}>
            <span className="pmc-stock-history-summary">
              <span>
                <strong>{document.documentId}</strong>
                <small>{transactionLabel(document.transactionType)} · {document.lineCount} รายการ</small>
              </span>
              <span>{document.actorDisplayName} · {formatThaiDateTime(document.createdAt)}</span>
            </span>
          </summary>
          <div className="pmc-stock-history-details">
            <ul aria-label={`สินค้าในเอกสาร ${document.documentId}`}>
              {document.lines.map((line) => <li key={`${document.documentId}:${line.productId}`}>
                <span>{line.productName}</span>
                <strong>{signedQuantity(line.quantityDeltaMilli)} {line.unit}</strong>
              </li>)}
            </ul>
            {canManageStock && document.transactionType === 'ADJUST' && document.reason
              ? <p className="pmc-stock-history-reason">เหตุผล: {document.reason}</p>
              : null}
          </div>
        </details>
      </li>)}
    </ol> : <p className="pmc-stock-empty">ยังไม่มีประวัติ Stock</p>}

    {page.nextCursor ? <button
      className="pmc-stock-history-more"
      type="button"
      disabled={loadingMore}
      onClick={() => onLoadMore(page.nextCursor!)}
    >{loadingMore ? 'กำลังโหลด' : 'โหลดเพิ่มเติม'}</button> : null}
  </main>
}

function compareNewestFirst(left: StockDocumentSummary, right: StockDocumentSummary): number {
  const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt)
  return byTime || right.documentId.localeCompare(left.documentId)
}

function formatThaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function signedQuantity(value: number): string {
  const quantity = formatQuantityMilli(value)
  return value > 0 ? `+${quantity}` : quantity
}

function transactionLabel(value: StockTransactionType): string {
  if (value === 'OPENING') return 'ยอดตั้งต้น'
  if (value === 'RECEIVE') return 'รับเข้า'
  if (value === 'ISSUE') return 'เบิก'
  return 'ปรับยอด'
}
