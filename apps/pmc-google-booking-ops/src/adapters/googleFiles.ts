import type { FilePort } from '../ports'

function ensurePrivateChild(parent: GoogleAppsScript.Drive.Folder, name: string): GoogleAppsScript.Drive.Folder {
  const existing = parent.getFoldersByName(name)
  if (existing.hasNext()) return existing.next()
  const created = parent.createFolder(name)
  created.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE)
  return created
}

export function createGoogleFilePort(incomingFolderId: string): FilePort {
  const incoming = DriveApp.getFolderById(incomingFolderId)
  const imported = ensurePrivateChild(incoming, 'Imported')
  const quarantined = ensurePrivateChild(incoming, 'Quarantine')
  return {
    readText(fileId, encoding) {
      return DriveApp.getFileById(fileId).getBlob().getDataAsString(encoding)
    },
    listIncomingFileIds() {
      const files = incoming.getFiles()
      const rows: Array<{ id: string; name: string }> = []
      while (files.hasNext()) {
        const file = files.next()
        rows.push({ id: file.getId(), name: file.getName() })
      }
      return rows.sort((left, right) => left.name.localeCompare(right.name)).map((row) => row.id)
    },
    moveToImported(fileId) {
      DriveApp.getFileById(fileId).moveTo(imported)
    },
    quarantine(fileId) {
      DriveApp.getFileById(fileId).moveTo(quarantined)
    },
  }
}
