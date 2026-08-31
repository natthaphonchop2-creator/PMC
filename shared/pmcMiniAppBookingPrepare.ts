import type { BookingDraftInputV2 } from '../src/apps/pmc-mini-app/contracts.js'
import type { BookingProtocolVersion } from './pmcBookingProtocol.js'

export interface BookingPrepareCapability {
  supported: 2
  minimumMutation: BookingProtocolVersion
  prepare: boolean
}

export interface BookingPrepareInput {
  protocolVersion: 2
  version: number
  input: BookingDraftInputV2
  paymentFiles: File[]
  chatFiles: File[]
}

export type BookingPrepareFilesInput = Pick<BookingPrepareInput, 'input' | 'paymentFiles' | 'chatFiles'>
