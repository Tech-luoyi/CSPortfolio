export function nextSequence(stored: number, existingMaximum: number, externalFloor = 0): number {
  const current = Math.max(stored, existingMaximum, externalFloor)
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('invalid submission sequence')
  }
  return current + 1
}

export function formatSubmissionCode(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('invalid submission year')
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('invalid submission sequence')
  return `JX-${year}-${String(sequence).padStart(4, '0')}`
}
