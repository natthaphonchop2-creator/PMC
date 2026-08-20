import { expect, it } from 'vitest'
import { verifyBookingEvidenceAccess } from '../scripts/verifyBookingEvidenceAccess.mjs'

it('reports read-only access without identifiers or content', async () => {
  const result = await verifyBookingEvidenceAccess({
    credentialJson: JSON.stringify({
      type: 'service_account',
      client_email: 'test@example.invalid',
      private_key: 'test',
    }),
    fileId: 'synthetic-file-id',
    drive: {
      metadata: async () => ({ mimeType: 'image/jpeg' }),
      firstBytes: async () => Buffer.from('synthetic'),
    },
  })

  expect(result).toEqual({
    credentialType: 'service_account',
    metadataReadable: true,
    mediaReadable: true,
    mimeAllowed: true,
    writeCapabilityRequested: false,
  })
  expect(JSON.stringify(result)).not.toContain('synthetic-file-id')
  expect(JSON.stringify(result)).not.toContain('test@example.invalid')
})

it('rejects non-service credentials and unsupported media', async () => {
  await expect(
    verifyBookingEvidenceAccess({
      credentialJson: JSON.stringify({ type: 'authorized_user' }),
      fileId: 'synthetic-file-id',
      drive: {
        metadata: async () => ({ mimeType: 'image/jpeg' }),
        firstBytes: async () => Buffer.from('synthetic'),
      },
    }),
  ).rejects.toThrow('Expected service_account credential')

  const unsupported = await verifyBookingEvidenceAccess({
    credentialJson: JSON.stringify({ type: 'service_account' }),
    fileId: 'synthetic-file-id',
    drive: {
      metadata: async () => ({ mimeType: 'application/pdf' }),
      firstBytes: async () => Buffer.from('synthetic'),
    },
  })
  expect(unsupported.mimeAllowed).toBe(false)
})
