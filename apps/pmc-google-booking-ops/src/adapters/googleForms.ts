import type { BookingIntake, CallResult } from '../domain/types'
import type { FormsPort } from '../ports'
import {
  BOOKING_FORM_LABELS,
  BOOKING_FORM_LEGACY_LABELS,
} from '../config'
import { compactAeChoices, compactIdentityFormPlan } from '../domain/formIdentity'

const CLOSER_FORM_TITLES: string[] = [
  BOOKING_FORM_LABELS.closerName,
  BOOKING_FORM_LEGACY_LABELS.closerName,
]
const AE_FORM_TITLES: string[] = [
  BOOKING_FORM_LABELS.aeName,
  BOOKING_FORM_LEGACY_LABELS.aeName,
]

export interface BookingFormEventInput {
  responseKey: string
  submittedAt: string
  submitterEmail: string
  namedValues: Record<string, string[]>
}

export interface CallResultFormEventInput {
  submittedAt: string
  submitterEmail: string
  namedValues: Record<string, string[]>
}

function requiredValue(namedValues: Record<string, string[]>, label: string): string {
  const value = namedValues[label]?.[0]?.trim()
  if (!value) throw new Error(`missing Form field: ${label}`)
  return value
}

function requiredValueFromAliases(
  namedValues: Record<string, string[]>,
  canonicalLabel: string,
  aliases: string[],
): string {
  for (const label of [canonicalLabel, ...aliases]) {
    const value = namedValues[label]?.[0]?.trim()
    if (value) return value
  }
  throw new Error(`missing Form field: ${canonicalLabel}`)
}

function driveFileIds(value: string): string[] {
  return [...new Set(value.match(/[\w-]{20,}/g) ?? [])]
}

export function parseBookingFormEvent(event: BookingFormEventInput): BookingIntake {
  return {
    formResponseId: event.responseKey,
    submittedAt: event.submittedAt,
    submitterEmail: event.submitterEmail.trim().toLowerCase(),
    closerName: requiredValueFromAliases(
      event.namedValues,
      BOOKING_FORM_LABELS.closerName,
      [BOOKING_FORM_LEGACY_LABELS.closerName],
    ),
    aeName: requiredValueFromAliases(
      event.namedValues,
      BOOKING_FORM_LABELS.aeName,
      [BOOKING_FORM_LEGACY_LABELS.aeName],
    ),
    customerName: requiredValue(event.namedValues, BOOKING_FORM_LABELS.customerName),
    facebookName: requiredValue(event.namedValues, BOOKING_FORM_LABELS.facebookName),
    phone: requiredValue(event.namedValues, BOOKING_FORM_LABELS.phone),
    doctorId: requiredValue(event.namedValues, BOOKING_FORM_LABELS.doctorId),
    serviceId: requiredValue(event.namedValues, BOOKING_FORM_LABELS.serviceId),
    appointmentDate: requiredValue(event.namedValues, BOOKING_FORM_LABELS.appointmentDate),
    appointmentTime: requiredValue(event.namedValues, BOOKING_FORM_LABELS.appointmentTime),
    depositAmount: Number(requiredValue(event.namedValues, BOOKING_FORM_LABELS.depositAmount).replace(/,/g, '')),
    channelId: event.namedValues[BOOKING_FORM_LABELS.channelId]?.[0]?.trim() || null,
    paymentEvidenceFileIds: driveFileIds(requiredValue(event.namedValues, BOOKING_FORM_LABELS.paymentEvidence)),
    chatEvidenceFileIds: driveFileIds(requiredValue(event.namedValues, BOOKING_FORM_LABELS.chatEvidence)),
  }
}

const CALL_RESULTS = new Set<CallResult>([
  'REBOOKED',
  'NO_ANSWER',
  'CALL_BACK_REQUESTED',
  'NOT_READY',
  'DECLINED',
  'WRONG_NUMBER',
])

export function parseCallResultFormEvent(event: CallResultFormEventInput): {
  caseId: string
  result: CallResult
  nextCallAt: string | null
  note: string
  actor: string
} {
  const result = requiredValue(event.namedValues, 'ผลการโทร') as CallResult
  if (!CALL_RESULTS.has(result)) throw new Error('unsupported call result')
  const nextDate = event.namedValues['วันโทรครั้งถัดไป']?.[0]?.trim() ?? ''
  return {
    caseId: requiredValue(event.namedValues, 'Case ID'),
    result,
    nextCallAt: nextDate ? `${nextDate}T09:00:00+07:00` : null,
    note: event.namedValues['หมายเหตุ']?.[0]?.trim() ?? '',
    actor: event.submitterEmail.trim().toLowerCase(),
  }
}

function bangkokIso(date: GoogleAppsScript.Base.Date): string {
  return Utilities.formatDate(date, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX")
}

function responseValues(response: string | string[] | string[][]): string[] {
  if (typeof response === 'string') return [response]
  return response.flat().map(String)
}

function formNamedValues(response: GoogleAppsScript.Forms.FormResponse): Record<string, string[]> {
  return Object.fromEntries(
    response.getItemResponses().map((itemResponse) => [
      itemResponse.getItem().getTitle(),
      responseValues(itemResponse.getResponse()),
    ]),
  )
}

export function bookingFormResponseEvent(
  event: GoogleAppsScript.Events.FormsOnFormSubmit,
): BookingFormEventInput {
  return {
    responseKey: event.response.getId(),
    submittedAt: bangkokIso(event.response.getTimestamp()),
    submitterEmail: event.response.getRespondentEmail(),
    namedValues: formNamedValues(event.response),
  }
}

export function callResultFormResponseEvent(
  event: GoogleAppsScript.Events.FormsOnFormSubmit,
): CallResultFormEventInput {
  return {
    submittedAt: bangkokIso(event.response.getTimestamp()),
    submitterEmail: event.response.getRespondentEmail(),
    namedValues: formNamedValues(event.response),
  }
}

function listItem(form: GoogleAppsScript.Forms.Form, title: string): GoogleAppsScript.Forms.ListItem {
  const item = form.getItems(FormApp.ItemType.LIST).find((candidate) => candidate.getTitle() === title)
  if (!item) throw new Error(`missing Form list field: ${title}`)
  return item.asListItem()
}

export function createGoogleFormsPort(bookingFormId: string, callResultFormId: string): FormsPort {
  return {
    syncBookingChoices(closerNames, aeNames, doctorIds, serviceIds, channelIds) {
      const form = FormApp.openById(bookingFormId)
      listItem(form, BOOKING_FORM_LABELS.closerName).setChoiceValues(closerNames)
      listItem(form, BOOKING_FORM_LABELS.aeName).setChoiceValues(compactAeChoices(aeNames))
      listItem(form, BOOKING_FORM_LABELS.doctorId).setChoiceValues(doctorIds)
      listItem(form, BOOKING_FORM_LABELS.serviceId).setChoiceValues(serviceIds)
      if (channelIds.length) listItem(form, BOOKING_FORM_LABELS.channelId).setChoiceValues(channelIds)
    },
    syncCallResultChoices(results) {
      const form = FormApp.openById(callResultFormId)
      listItem(form, 'ผลการโทร').setChoiceValues(results)
    },
    bookingCollectsEmail() {
      return FormApp.openById(bookingFormId).collectsEmail()
    },
    bookingHasCloserField() {
      const form = FormApp.openById(bookingFormId)
      return form
        .getItems(FormApp.ItemType.LIST)
        .filter((item) => CLOSER_FORM_TITLES.includes(item.getTitle()))
        .length === 1
    },
    bookingHasAeField() {
      const form = FormApp.openById(bookingFormId)
      return form
        .getItems(FormApp.ItemType.LIST)
        .filter((item) => AE_FORM_TITLES.includes(item.getTitle()))
        .length === 1
    },
    bookingHasFacebookNameField() {
      const form = FormApp.openById(bookingFormId)
      const candidates = form
        .getItems()
        .filter((item) => item.getTitle() === BOOKING_FORM_LABELS.facebookName)
      return candidates.length === 1 &&
        candidates[0].getType() === FormApp.ItemType.TEXT &&
        candidates[0].asTextItem().isRequired()
    },
    pauseBookingResponses() {
      FormApp.openById(bookingFormId).setAcceptingResponses(false)
    },
    ensureCloserField() {
      const form = FormApp.openById(bookingFormId)
      const candidates = form
        .getItems(FormApp.ItemType.LIST)
        .filter((item) => CLOSER_FORM_TITLES.includes(item.getTitle()))
      if (candidates.length > 1) throw new Error('expected at most one closer Form field')
      if (candidates.length) {
        candidates[0]
          .asListItem()
          .setTitle(BOOKING_FORM_LABELS.closerName)
          .setRequired(true)
        form.moveItem(candidates[0], 0)
      } else {
        form.addListItem().setTitle(BOOKING_FORM_LABELS.closerName).setRequired(true)
        form.moveItem(form.getItems().length - 1, 0)
      }
    },
    renameAdminFieldToAe() {
      const form = FormApp.openById(bookingFormId)
      const candidates = form
        .getItems(FormApp.ItemType.LIST)
        .filter((item) => [
          'Admin ผู้รับจอง',
          BOOKING_FORM_LABELS.aeName,
          BOOKING_FORM_LEGACY_LABELS.aeName,
        ].includes(item.getTitle()))
      if (candidates.length !== 1) throw new Error('expected one Admin/AE Form field')
      candidates[0].asListItem().setTitle(BOOKING_FORM_LABELS.aeName).setRequired(true)
    },
    configureCompactIdentityFields(aeNames) {
      const form = FormApp.openById(bookingFormId)
      const items = form.getItems(FormApp.ItemType.LIST).map((item) => item.asListItem())
      const plan = compactIdentityFormPlan(items.map((item) => item.getTitle()), aeNames)
      const closer = items.find((item) => item.getTitle() === plan.closerSourceTitle)
      const ae = items.find((item) => item.getTitle() === plan.aeSourceTitle)
      if (!closer || !ae) throw new Error('booking identity Form fields mismatch')
      closer.setTitle(plan.closerTargetTitle).setRequired(true)
      ae
        .setTitle(plan.aeTargetTitle)
        .setChoiceValues(plan.aeChoices)
        .setRequired(true)
    },
    ensureFacebookNameField() {
      const form = FormApp.openById(bookingFormId)
      const candidates = form
        .getItems()
        .filter((item) => item.getTitle() === BOOKING_FORM_LABELS.facebookName)
      if (candidates.length > 1) throw new Error('expected at most one Facebook name Form field')
      if (candidates.length === 1 && candidates[0].getType() !== FormApp.ItemType.TEXT) {
        throw new Error('Facebook name Form field must be short answer')
      }

      const facebookItem = candidates.length
        ? candidates[0].asTextItem()
        : form.addTextItem().setTitle(BOOKING_FORM_LABELS.facebookName)
      facebookItem
        .setHelpText('หากลูกค้าไม่มี Facebook ให้กรอก ไม่มี')
        .setRequired(true)

      const items = form.getItems()
      const customerIndex = items.findIndex(
        (item) => item.getTitle() === BOOKING_FORM_LABELS.customerName,
      )
      if (customerIndex === -1) throw new Error('missing customer name Form field')
      const facebookIndex = items.findIndex(
        (item) => item.getTitle() === BOOKING_FORM_LABELS.facebookName,
      )
      if (facebookIndex === -1) throw new Error('Facebook name Form field was not created')
      form.moveItem(facebookIndex, facebookIndex < customerIndex ? customerIndex : customerIndex + 1)
    },
    resumeBookingResponses() {
      FormApp.openById(bookingFormId).setAcceptingResponses(true)
    },
    callResultPrefillUrl(caseId) {
      const form = FormApp.openById(callResultFormId)
      const item = form
        .getItems(FormApp.ItemType.TEXT)
        .find((candidate) => candidate.getTitle() === 'Case ID')
      if (!item) throw new Error('missing Call Result Case ID field')
      return form
        .createResponse()
        .withItemResponse(item.asTextItem().createResponse(caseId))
        .toPrefilledUrl()
    },
  }
}
