import type { DatabaseHealthRepository, FileStorage } from '../repositories/contracts'

export function createHealthApp(database: DatabaseHealthRepository, storage: Pick<FileStorage, 'checkWritable'>) {
  return Object.freeze({
    async ready() {
      try {
        const result = database.check()
        if (!result.migrated) return null
        await storage.checkWritable()
        return { ok: true, status: 'ready', schemaVersion: result.schemaVersion }
      } catch {
        return null
      }
    },
  })
}
