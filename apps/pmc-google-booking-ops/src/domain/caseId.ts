export function formatCaseId(nowIso: string, sequence: number): string {
  const match = /^(\d{4})-(\d{2})-/.exec(nowIso)
  if (!match) throw new Error('invalid case timestamp')
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) throw new Error('invalid case sequence')
  return `PMC-${match[1]}${match[2]}-${String(sequence).padStart(4, '0')}`
}
