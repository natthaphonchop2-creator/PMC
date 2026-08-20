import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { google } from 'googleapis'

export async function verifyBookingEvidenceAccess({ credentialJson, fileId, drive }) {
  let credentials
  try {
    credentials = JSON.parse(credentialJson)
  } catch {
    throw new Error('Invalid Service Account JSON')
  }
  if (credentials.type !== 'service_account') {
    throw new Error('Expected service_account credential')
  }

  const metadata = await drive.metadata(fileId)
  const bytes = await drive.firstBytes(fileId)
  return {
    credentialType: 'service_account',
    metadataReadable: true,
    mediaReadable: Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 64,
    mimeAllowed: ['image/jpeg', 'image/png'].includes(metadata.mimeType),
    writeCapabilityRequested: false,
  }
}

async function createRealDrive(credentials) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  const api = google.drive({ version: 'v3', auth })
  return {
    async metadata(fileId) {
      const result = await api.files.get({ fileId, fields: 'mimeType' })
      return { mimeType: String(result.data.mimeType ?? '') }
    },
    async firstBytes(fileId) {
      const result = await api.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer', headers: { Range: 'bytes=0-63' } },
      )
      return Buffer.from(result.data).subarray(0, 64)
    },
  }
}

async function main() {
  const credentialJson = process.env.BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON ?? ''
  const fileId = process.env.BOOKING_EVIDENCE_TEST_FILE_ID ?? ''
  if (!credentialJson || !fileId) {
    throw new Error('BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON and BOOKING_EVIDENCE_TEST_FILE_ID are required')
  }

  let credentials
  try {
    credentials = JSON.parse(credentialJson)
  } catch {
    throw new Error('Invalid Service Account JSON')
  }
  const result = await verifyBookingEvidenceAccess({
    credentialJson,
    fileId,
    drive: await createRealDrive(credentials),
  })
  console.log(JSON.stringify(result))
  if (
    !result.metadataReadable ||
    !result.mediaReadable ||
    !result.mimeAllowed ||
    result.writeCapabilityRequested
  ) {
    process.exitCode = 1
  }
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Booking evidence access verification failed')
    process.exitCode = 1
  })
}
