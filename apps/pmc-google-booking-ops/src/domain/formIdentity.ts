import {
  BOOKING_FORM_LABELS,
  BOOKING_FORM_LEGACY_LABELS,
  NO_AE_OPTION,
} from '../config'

export interface CompactIdentityFormPlan {
  closerSourceTitle: string
  closerTargetTitle: typeof BOOKING_FORM_LABELS.closerName
  aeSourceTitle: string
  aeTargetTitle: typeof BOOKING_FORM_LABELS.aeName
  aeChoices: string[]
}

export function compactAeChoices(aeNames: string[]): string[] {
  const normalizedAeNames = aeNames.map((name) => name.trim()).filter(Boolean)
  return [
    NO_AE_OPTION,
    ...new Set(normalizedAeNames.filter((name) => name !== NO_AE_OPTION)),
  ]
}

export function compactIdentityFormPlan(
  existingTitles: string[],
  aeNames: string[],
): CompactIdentityFormPlan {
  const closerTitles: string[] = [
    BOOKING_FORM_LABELS.closerName,
    BOOKING_FORM_LEGACY_LABELS.closerName,
  ]
  const aeTitles: string[] = [BOOKING_FORM_LABELS.aeName, BOOKING_FORM_LEGACY_LABELS.aeName]
  const closerMatches = existingTitles.filter((title) => closerTitles.includes(title))
  const aeMatches = existingTitles.filter((title) => aeTitles.includes(title))
  if (closerMatches.length !== 1 || aeMatches.length !== 1) {
    throw new Error('booking identity Form fields mismatch')
  }
  return {
    closerSourceTitle: closerMatches[0],
    closerTargetTitle: BOOKING_FORM_LABELS.closerName,
    aeSourceTitle: aeMatches[0],
    aeTargetTitle: BOOKING_FORM_LABELS.aeName,
    aeChoices: compactAeChoices(aeNames),
  }
}
