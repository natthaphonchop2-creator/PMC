export const SCRIPT_PROPERTY_KEYS = {
  spreadsheetId: 'PMC_SPREADSHEET_ID',
  bookingFormId: 'PMC_BOOKING_FORM_ID',
  callResultFormId: 'PMC_CALL_RESULT_FORM_ID',
  driveRootId: 'PMC_DRIVE_ROOT_ID',
  jeraIncomingFolderId: 'PMC_JERA_INCOMING_FOLDER_ID',
  backupFolderId: 'PMC_BACKUP_FOLDER_ID',
  adminLineGroupId: 'PMC_ADMIN_LINE_GROUP_ID',
  lineAccessToken: 'LINE_CHANNEL_ACCESS_TOKEN',
  lineDirectoryCaptureEnabled: 'LINE_DIRECTORY_CAPTURE_ENABLED',
  bookingIngressSecret: 'PMC_BOOKING_INGRESS_SECRET',
  mediaBaseUrl: 'BOOKING_MEDIA_BASE_URL',
  mediaSigningSecret: 'BOOKING_MEDIA_SIGNING_SECRET',
  brandLogoUrl: 'BOOKING_BRAND_LOGO_URL',
} as const

export const BOOKING_FORM_LABELS = {
  aeName: 'AE ผู้เปิดแชท',
  customerName: 'ชื่อลูกค้า',
  phone: 'เบอร์มือถือ',
  doctorId: 'หมอ',
  serviceId: 'บริการ/โปรแกรม',
  appointmentDate: 'วันที่นัด',
  appointmentTime: 'เวลานัด',
  depositAmount: 'จำนวนเงินจอง',
  channelId: 'เพจคลินิก/ช่องทาง',
  paymentEvidence: 'สลิปเงินจอง',
  chatEvidence: 'หลักฐานแชท',
} as const
