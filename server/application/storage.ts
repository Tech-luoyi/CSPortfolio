import type { FileStorage } from '../repositories/contracts'

export function createStorageApp(storage: FileStorage) {
  return Object.freeze({
    newName(originalName: string) { return storage.newName(originalName) },
    createWriteStream(name: string) { return storage.createWriteStream(name) },
    readPrefix(name: string, length: number) { return storage.readPrefix(name, length) },
    read(name: string) { return storage.read(name) },
    commit(temporaryName: string, finalName: string) { return storage.commit(temporaryName, finalName) },
    stat(name: string) { return storage.stat(name) },
    checkWritable() { return storage.checkWritable() },
    delete(name: string) { return storage.delete(name) },
  })
}
