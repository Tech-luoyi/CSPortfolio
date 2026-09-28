import type { Identity } from '../../domain/auth/identity'
import type { Readable, Writable } from 'node:stream'

export interface SubmissionRepository {
  create(input: Record<string, unknown>): string
  findByStudent(studentId: string, campaignId?: string): any
  findPublicByCodeAndStudent(code: string, studentId: string): any
  findByCodeAndStudent(code: string, studentId: string): any
  listForAdmin(me: Identity, status: string, search: string, page: number, size?: number, deptFilter?: string | null): any
  update(me: Identity, id: number, fields: { status?: string; admin_note?: string }): any
  getById(id: number): any
  delete(id: number): void
  reassign(id: number, to: string, by: number): void
  stats(me: Identity): any
  statsByDept(): any
  export(me: Identity): any[]
  getFileOwner(name: string): string | null
}

export interface CampaignRepository {
  getCurrent(): any
  getById(id: string): any
  list(): any[]
  create(input: { id: string; year: number; slug: string; name: string; status?: string; starts_at?: string; ends_at?: string }): any
}

export interface AdminRepository {
  getByUsername(username: string): any
  getById(id: number): any
  create(username: string, password: string, role: string, dept: string, displayName: string): number
  list(): any[]
  updatePassword(id: number, password: string): void
  bumpSession(id: number): void
  setActive(id: number, active: boolean): void
  updateRole(id: number, role: string, dept: string): void
  countActiveSupers(excludeId?: number): number
  hasAny(): boolean
  audit(actorId: number, actorName: string, action: string, target: string, detail: string): void
}

export interface DatabaseHealthRepository {
  check(): { schemaVersion: number; migrated: boolean }
}

export interface SettingsRepository {
  get(key: string): string
  set(key: string, value: string): void
}

export interface FileStorage {
  newName(originalName: string): string
  createWriteStream(name: string): Writable & { bytesWritten?: number }
  writeStream(name: string, source: Readable): Promise<void>
  readPrefix(name: string, length: number): Promise<Buffer>
  read(name: string): Readable
  commit(temporaryName: string, finalName: string): Promise<void>
  stat(name: string): Promise<{ size: number; isFile: boolean } | null>
  checkWritable(): Promise<void>
  delete(name: string): Promise<void>
}

export interface RateLimitPolicy {
  maxAttempts: number
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
}

export interface RateLimiter {
  check(key: string, policy: RateLimitPolicy): RateLimitResult
  reset(key: string): void
}
