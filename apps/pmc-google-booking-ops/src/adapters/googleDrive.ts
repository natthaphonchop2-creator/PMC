import type { BookingCase, BookingIntake } from '../domain/types'
import type { BackupPort, DrivePort } from '../ports'

export interface DriveEvidenceResult {
  folderId: string
  folderUrl: string
  path: string
  renamedFiles: string[]
}

function safeFolderName(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0)
      return character === '/' || character === '\\' || code < 32 || code === 127 ? ' ' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function extension(fileName: string): string {
  const match = /(\.[a-z0-9]{1,8})$/i.exec(fileName)
  if (!match) throw new Error('evidence file has no supported extension')
  return match[1].toLowerCase()
}

function ensureEvidenceFile(
  drive: DrivePort,
  sourceFileId: string,
  folderId: string,
  targetName: string,
): string {
  if (!drive.findFileByName(folderId, targetName)) {
    drive.moveAndRenameFile(sourceFileId, folderId, targetName)
  }
  return targetName
}

export function ensureCaseEvidenceFolder(
  booking: BookingCase,
  intake: BookingIntake,
  drive: DrivePort,
): DriveEvidenceResult {
  const [year, month] = booking.depositReceivedAt.slice(0, 7).split('-')
  const caseFolderName = `${safeFolderName(booking.customerName)} - ${booking.caseId}`
  let folderId = booking.driveFolderId

  if (!folderId) {
    const yearFolder = drive.ensureChildFolder(drive.rootFolderId(), year, `year:${year}`)
    const monthFolder = drive.ensureChildFolder(yearFolder.id, month, `month:${year}-${month}`)
    folderId = drive.ensureChildFolder(monthFolder.id, caseFolderName, `case:${booking.caseId}`).id
  }

  const renamedFiles = [
    ...intake.paymentEvidenceFileIds.map((fileId, index) =>
      ensureEvidenceFile(
        drive,
        fileId,
        folderId,
        `${booking.caseId}_PAYMENT_${String(index + 1).padStart(2, '0')}${extension(drive.fileName(fileId))}`,
      ),
    ),
    ...intake.chatEvidenceFileIds.map((fileId, index) =>
      ensureEvidenceFile(
        drive,
        fileId,
        folderId,
        `${booking.caseId}_CHAT_${String(index + 1).padStart(2, '0')}${extension(drive.fileName(fileId))}`,
      ),
    ),
  ]

  return {
    folderId,
    folderUrl: drive.folderUrl(folderId),
    path: `PMC Bookings/${year}/${month}/${caseFolderName}`,
    renamedFiles,
  }
}

export function createGoogleDrivePort(rootFolderId: string): DrivePort {
  function folder(folderId: string) {
    return DriveApp.getFolderById(folderId)
  }

  return {
    rootFolderId: () => rootFolderId,
    ensureChildFolder(parentId, name, marker) {
      const parent = folder(parentId)
      const candidates = parent.getFoldersByName(name)
      while (candidates.hasNext()) {
        const candidate = candidates.next()
        if (candidate.getDescription() === `PMC_MARKER:${marker}`) return { id: candidate.getId(), name }
      }
      const created = parent.createFolder(name)
      created.setDescription(`PMC_MARKER:${marker}`)
      created.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE)
      return { id: created.getId(), name }
    },
    fileName: (fileId) => DriveApp.getFileById(fileId).getName(),
    findFileByName(folderId, name) {
      const files = folder(folderId).getFilesByName(name)
      return files.hasNext() ? files.next().getId() : null
    },
    moveAndRenameFile(fileId, folderId, name) {
      const file = DriveApp.getFileById(fileId)
      file.setName(name)
      file.moveTo(folder(folderId))
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE)
      return file.getId()
    },
    folderUrl: (folderId) => folder(folderId).getUrl(),
    trashFolder(folderId) {
      folder(folderId).setTrashed(true)
    },
  }
}

export function createGoogleBackupPort(spreadsheetId: string, backupFolderId: string): BackupPort {
  const folder = DriveApp.getFolderById(backupFolderId)
  const backupName = (bangkokDate: string) => `PMC Booking Backup ${bangkokDate} ${spreadsheetId}`
  return {
    hasBackup(bangkokDate) {
      return folder.getFilesByName(backupName(bangkokDate)).hasNext()
    },
    createBackup(bangkokDate) {
      DriveApp.getFileById(spreadsheetId).makeCopy(backupName(bangkokDate), folder)
    },
  }
}
