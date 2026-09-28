import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import type { FileStorage } from '../../repositories/contracts'

export class LocalFileStorage implements FileStorage {
  readonly root: string

  constructor(root = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')) {
    this.root = resolve(root)
  }

  private path(name: string) {
    if (!name || basename(name) !== name || name.includes('..')) throw new Error('invalid storage key')
    const target = resolve(this.root, name)
    const relativePath = relative(this.root, target)
    if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + sep) || isAbsolute(relativePath)) {
      throw new Error('storage key escaped root')
    }
    return target
  }

  newName(originalName: string) {
    const extension = extname(originalName).toLowerCase()
    const safeExtension = /^\.[a-z0-9]{1,6}$/.test(extension) ? extension : ''
    return `${randomUUID().replace(/-/g, '')}${safeExtension}`
  }

  createWriteStream(name: string) {
    const target = this.path(name)
    mkdirSync(this.root, { recursive: true })
    return createWriteStream(target, { flags: 'wx', mode: 0o640 }) as WriteStream
  }

  async writeStream(name: string, source: Readable) {
    const target = this.path(name)
    await mkdir(this.root, { recursive: true })
    const temporary = this.path(`.${randomUUID()}.part`)
    try {
      await pipeline(source, createWriteStream(temporary, { flags: 'wx', mode: 0o640 }))
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  async readPrefix(name: string, length: number) {
    const handle = await open(this.path(name), 'r')
    try {
      const buffer = Buffer.alloc(Math.max(0, length))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  read(name: string) {
    return createReadStream(this.path(name))
  }

  async commit(temporaryName: string, finalName: string) {
    await rename(this.path(temporaryName), this.path(finalName))
  }

  async stat(name: string) {
    const info = await stat(this.path(name)).catch(() => null)
    return info ? { size: info.size, isFile: info.isFile() } : null
  }

  async checkWritable() {
    await mkdir(this.root, { recursive: true })
    const probe = this.path(`.health-${randomUUID()}.tmp`)
    const handle = await open(probe, 'wx', 0o600)
    await handle.close()
    await rm(probe, { force: true })
  }

  async delete(name: string) {
    await rm(this.path(name), { force: true })
  }
}
