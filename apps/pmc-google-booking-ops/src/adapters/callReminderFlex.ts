import type { BookingCase, CallTask } from '../domain/types'
import { formatThaiAppointment } from './minimalReceiptFlex'

const TEXT = '#282624'
const SECONDARY = '#77716D'
const GOLD = '#B78220'
const RED = '#C2413A'
const TRACK = '#E8E4DE'

type FlexComponent = Record<string, unknown>

export interface CallReminderTiming {
  kind: 'FUTURE' | 'ADVANCE' | 'DUE' | 'OVERDUE'
  label: string
  progress: number
  priority: number
}

export interface CallReminderCard {
  booking: BookingCase
  task: CallTask
  timing: CallReminderTiming
  callResultUrl: string
}

function dateNumber(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) throw new Error('invalid call reminder date')
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function callReminderTiming(todayIso: string, nextCallAt: string): CallReminderTiming {
  const daysFromDue = Math.round((dateNumber(todayIso) - dateNumber(nextCallAt)) / 86_400_000)
  if (daysFromDue < -1) return { kind: 'FUTURE', label: '', progress: 0, priority: 3 }
  if (daysFromDue === -1) {
    return { kind: 'ADVANCE', label: 'พรุ่งนี้ต้องโทร', progress: 0, priority: 2 }
  }
  if (daysFromDue <= 6) {
    const day = daysFromDue + 1
    return { kind: 'DUE', label: `วันที่ ${day} จาก 7`, progress: day, priority: 1 }
  }
  return {
    kind: 'OVERDUE',
    label: `เกินกำหนด ${daysFromDue - 6} วัน`,
    progress: 7,
    priority: 0,
  }
}

function progressBar(timing: CallReminderTiming): FlexComponent {
  const activeColor = timing.kind === 'OVERDUE' ? RED : GOLD
  return {
    type: 'box',
    layout: 'horizontal',
    height: '8px',
    cornerRadius: '4px',
    contents: Array.from({ length: 7 }, (_, index) => ({
      type: 'box',
      layout: 'vertical',
      flex: 1,
      backgroundColor: index < timing.progress ? activeColor : TRACK,
      contents: [],
    })),
  }
}

function detailRow(label: string, value: string): FlexComponent {
  return {
    type: 'box',
    layout: 'horizontal',
    margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: SECONDARY, flex: 4 },
      { type: 'text', text: value, size: 'xs', color: TEXT, weight: 'bold', wrap: true, flex: 7, align: 'end' },
    ],
  }
}

function customerBubble(card: CallReminderCard, queueUrl: string): FlexComponent {
  if (!card.callResultUrl.startsWith('https://')) throw new Error('Call Result URL must use HTTPS')
  if (!queueUrl.startsWith('https://')) throw new Error('Call Queue URL must use HTTPS')
  const callDate = formatThaiAppointment(card.task.nextCallAt)
  const statusColor = card.timing.kind === 'OVERDUE' ? RED : GOLD
  const phone = card.booking.phoneNormalized.replace(/\D/g, '')
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      backgroundColor: '#FFFFFF',
      contents: [
        { type: 'text', text: 'แจ้งเตือนโทรติดตาม', size: 'lg', weight: 'bold', color: TEXT },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      paddingTop: '0px',
      backgroundColor: '#FFFFFF',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          spacing: 'lg',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              width: '52px',
              height: '52px',
              cornerRadius: '26px',
              backgroundColor: statusColor,
              justifyContent: 'center',
              alignItems: 'center',
              flex: 0,
              contents: [
                { type: 'text', text: '☎', size: 'xl', weight: 'bold', color: '#FFFFFF', align: 'center' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              contents: [
                { type: 'text', text: callDate.date, size: 'md', weight: 'bold', color: TEXT, margin: 'xs' },
                { type: 'text', text: card.timing.label, size: 'xxs', weight: 'bold', color: statusColor, margin: 'xs' },
                { type: 'text', text: card.booking.customerName, size: 'sm', weight: 'bold', color: TEXT, wrap: true, margin: 'xs' },
              ],
            },
          ],
        },
        { type: 'separator', color: '#E6E3DF', margin: 'lg' },
        detailRow('เวลาโทร', callDate.time.replace('เวลา ', '')),
        detailRow('เบอร์โทร', card.booking.phoneNormalized),
        detailRow('โปรแกรม', card.booking.serviceId),
        detailRow('Admin', card.booking.adminName),
        { ...progressBar(card.timing), margin: 'lg' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      paddingTop: '8px',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              flex: 1,
              action: { type: 'uri', label: 'โทรหาลูกค้า', uri: `tel:${phone}` },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              flex: 1,
              action: { type: 'uri', label: 'บันทึกผลโทร', uri: card.callResultUrl },
            },
          ],
        },
        { type: 'separator', color: '#E6E3DF', margin: 'md' },
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          paddingTop: '4px',
          action: { type: 'uri', label: 'เปิด PMC Call Queue', uri: queueUrl },
          contents: [
            { type: 'text', text: 'PMC Call Queue', size: 'xs', color: SECONDARY, flex: 1 },
            { type: 'text', text: '›', size: 'md', color: SECONDARY, align: 'end' },
          ],
        },
      ],
    },
  }
}

function moreBubble(moreCount: number, queueUrl: string): FlexComponent {
  if (!queueUrl.startsWith('https://')) throw new Error('Call Queue URL must use HTTPS')
  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      justifyContent: 'center',
      alignItems: 'center',
      paddingAll: '24px',
      backgroundColor: '#FFFFFF',
      contents: [
        { type: 'text', text: 'รายการที่เหลือ', size: 'sm', color: SECONDARY },
        { type: 'text', text: `${moreCount} ราย`, size: '3xl', weight: 'bold', color: GOLD, margin: 'md' },
        { type: 'text', text: `ดูเพิ่มเติมอีก ${moreCount} ราย`, size: 'sm', color: TEXT, wrap: true, align: 'center', margin: 'md' },
        {
          type: 'button',
          style: 'primary',
          color: GOLD,
          margin: 'xl',
          action: { type: 'uri', label: 'ดูเพิ่มเติม', uri: queueUrl },
        },
      ],
    },
  }
}

export function buildCallReminderFlex(
  cards: CallReminderCard[],
  moreCount: number,
  queueUrl: string,
): Record<string, unknown> {
  if (!cards.length || cards.length > 10) throw new Error('Call reminder Flex requires 1-10 cards')
  const contents = cards.map((card) => customerBubble(card, queueUrl))
  if (moreCount > 0) contents.push(moreBubble(moreCount, queueUrl))
  return {
    type: 'flex',
    altText: `แจ้งเตือนโทรติดตาม ${cards.length + moreCount} ราย`,
    contents: { type: 'carousel', contents },
  }
}
